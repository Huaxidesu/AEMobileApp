// 合成计划确认：分组展示 + 选择 CPU + 提交
//
// CPU 分配策略（2026-10-27）：
// - 默认「自动分配」：从列表最上面（idx 最小）往下，选第一台「空闲 且 容量 >= 本次占用」的；
// - 手动点选后切到手动模式，弹层里可以点「自动分配」再切回来；
// - 弹层会列出**全部** CPU 并标注为什么不能用（忙碌 / 容量不足），不再静默过滤。
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Dimensions, FlatList, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { Ionicons } from '@expo/vector-icons';
import { useConfig } from '../config';
import { CraftPlan, CraftingCPUInfo, formatItemCount, request as apiRequest } from '../api';
import { resolveItem } from '../db';
import { readCache, scopeKey, writeCache } from '../cache';
import { colors, radius, spacing, card } from '../theme';
import { Chip, EmptyState, ItemIcon, PrimaryButton, ProgressBar } from '../components';
import { showToast } from '../toast';

interface Row {
  key: string;
  icon: string | null;
  /** 流体行（没有物品图标，用滴水图标兜底） */
  isFluid: boolean;
  fluidColor?: number | null;
  dname: string | null;
  missing: number;
  numberPresent: number;
  numberRemainingToCraft: number;
  name: string;
  meta: number;
  nbt?: string | null;
}

/** 一台 CPU 相对本次任务的状态 */
type CpuStatus = 'ok' | 'busy' | 'small';

const STATUS_LABEL: Record<CpuStatus, string> = {
  ok: '可用',
  busy: '忙碌',
  small: '容量不足',
};

export default function PlanReviewScreen({ route, navigation }: any) {
  const db = useSQLiteContext();
  const { config } = useConfig();
  const plan = route.params.plan as CraftPlan;
  const request = route.params.request as { item: string; meta: number; nbt: string; count: number; dname: string | null; icon: string | null };

  const rows: Row[] = useMemo(
    () =>
      plan.plan.map((t, i) => {
        const r = resolveItem(db, { name: t.name, meta: t.meta, nbt: t.nbt ?? undefined });
        return {
          key: `${t.name}:${t.meta}:${i}`,
          icon: r.icon,
          isFluid: r.isFluid === true,
          fluidColor: r.fluidColor ?? null,
          dname: r.dname ?? t.name,
          missing: t.missing,
          numberPresent: t.numberPresent,
          numberRemainingToCraft: t.numberRemainingToCraft,
          name: t.name,
          meta: t.meta,
          nbt: t.nbt,
        };
      }),
    [plan],
  );

  const missingRows = rows.filter((r) => r.missing > 0);
  const craftRows = rows.filter((r) => r.missing <= 0 && r.numberRemainingToCraft > 0);
  const haveRows = rows.filter((r) => r.missing <= 0 && r.numberRemainingToCraft <= 0);

  /** 本次合成需要占用的字节数，CPU 的存储容量必须 >= 这个值才能装下 */
  const needBytes = plan.bytesUsed;

  const [allCpus, setAllCpus] = useState<CraftingCPUInfo[]>([]);
  /** 列表是否已经落地过（含缓存/失败）：用来区分「还在加载」和「网络里真的没有 CPU」 */
  const [cpusLoaded, setCpusLoaded] = useState(false);
  const [cpuId, setCpuId] = useState<number | null>(null);
  /** 用户手动点过 CPU 之后就不再自动改写他的选择 */
  const [manual, setManual] = useState(false);
  const [allowMissing, setAllowMissing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canCraft = missingRows.length === 0 || allowMissing;

  const statusOf = useCallback(
    (c: CraftingCPUInfo): CpuStatus => {
      if (c.item != null) return 'busy';
      // AE2 的 storage 是可用存储字节数，装得下才能接这个任务
      if (c.storage < needBytes) return 'small';
      return 'ok';
    },
    [needBytes],
  );

  /** 可用的 CPU，按 idx 从小到大（也就是界面上从上到下） */
  const usableCpus = useMemo(
    () => allCpus.filter((c) => statusOf(c) === 'ok').sort((a, b) => a.idx - b.idx),
    [allCpus, statusOf],
  );

  /** 自动分配结果：从上往下的第一台 */
  const autoCpu = usableCpus[0] ?? null;

  // 自动分配：只在用户没手动选过的时候生效
  useEffect(() => {
    if (manual) return;
    setCpuId(autoCpu ? autoCpu.idx : null);
  }, [autoCpu, manual]);

  // 与合成监控共用同一份 CPU 列表缓存（存的是全量列表，这里自己按需筛）
  const cacheKey = `cpus:${scopeKey(config)}`;
  useEffect(() => {
    let alive = true;
    readCache<CraftingCPUInfo[]>(cacheKey).then((hit) => {
      if (!alive || !hit) return;
      setCpusLoaded(true);
      setAllCpus((prev) => (prev.length > 0 ? prev : hit.data));
    });
    return () => {
      alive = false;
    };
  }, [cacheKey]);

  useEffect(() => {
    let alive = true;
    apiRequest<CraftingCPUInfo[]>(config, 'cpusOnce', {
      ...(config.mainnet ?? {}),
    })
      .then((resp) => {
        if (!alive) return;
        setCpusLoaded(true);
        if (!resp.succeed) return;
        const all = resp.body ?? [];
        writeCache(cacheKey, all);
        setAllCpus(all);
        const ok = all.filter((c) => statusOf(c) === 'ok');
        if (ok.length === 0) {
          showToast(
            all.length === 0 ? '网络里没有合成 CPU' : `没有能装下本次任务的空闲 CPU（需要 ${formatItemCount(needBytes)} 字节）`,
            'bad',
          );
        }
      })
      .catch(() => {
        // 取不到实时列表时保留缓存结果，提交阶段仍会由服务器校验
        if (alive) {
          setCpusLoaded(true);
          showToast('获取 CPU 列表失败，显示的是缓存数据', 'bad');
        }
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    if (cpuId == null) {
      showToast('请先选择一个合成 CPU', 'bad');
      return;
    }
    setSubmitting(true);
    try {
      const resp = await apiRequest<string>(config, 'start', {
        ...(config.mainnet ?? {}),
        item: request.item,
        meta: request.meta,
        nbt: request.nbt,
        count: request.count,
        cpuId,
        allowMissing,
      });
      if (resp.succeed) {
        showToast('合成任务已提交', 'ok');
        navigation.popToTop();
      } else {
        showToast(resp.message ?? '提交失败', 'bad');
      }
    } catch {
      showToast('提交失败，请检查网络', 'bad');
    }
    setSubmitting(false);
  }

  const sections: { title: string; tone: 'bad' | 'accent' | 'ok'; data: Row[] }[] = ([
    { title: `缺失 ${missingRows.length}`, tone: 'bad', data: missingRows },
    { title: `需合成 ${craftRows.length}`, tone: 'accent', data: craftRows },
    { title: `已拥有 ${haveRows.length}`, tone: 'ok', data: haveRows },
  ] as { title: string; tone: 'bad' | 'accent' | 'ok'; data: Row[] }[]).filter((s) => s.data.length > 0);

  const selectedCpu = allCpus.find((c) => c.idx === cpuId) ?? null;
  const sortedAll = useMemo(() => [...allCpus].sort((a, b) => a.idx - b.idx), [allCpus]);

  return (
    <View style={styles.screen}>
      {/* 目标摘要 */}
      <View style={[card, { flexDirection: 'row', alignItems: 'center', gap: spacing.m, margin: spacing.l, marginBottom: 0, padding: spacing.m }]}>
        <ItemIcon uri={request.icon} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>
            {request.dname ?? request.item}
          </Text>
          <Text style={{ color: colors.textDim, fontSize: 12 }}>
            × {formatItemCount(request.count)} · 需要 CPU 容量 ≥ {formatItemCount(needBytes)} 字节
          </Text>
        </View>
      </View>

      {/* CPU 选择 */}
      <TouchableOpacity style={[card, { margin: spacing.l, padding: spacing.m }]} onPress={() => setPickerOpen(true)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s, flex: 1 }}>
            <Ionicons name="hardware-chip" size={18} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
                {selectedCpu
                  ? `${manual ? '手动' : '自动分配'} · CPU #${selectedCpu.idx} ${selectedCpu.cpuName}`
                  : !cpusLoaded
                  ? '正在获取 CPU 列表…'
                  : allCpus.length > 0
                  ? '没有能装下本次任务的空闲 CPU'
                  : '网络里没有合成 CPU'}
              </Text>
              {selectedCpu ? (
                <Text style={{ color: colors.textFaint, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
                  容量 {formatItemCount(selectedCpu.storage)} · 并行 {selectedCpu.parallelism} · 剩余可装{' '}
                  {formatItemCount(Math.max(0, selectedCpu.storage - needBytes))}
                </Text>
              ) : null}
            </View>
          </View>
          <Ionicons name="chevron-down" size={16} color={colors.textFaint} />
        </View>
      </TouchableOpacity>

      {/* 缺失时允许缺失开关 */}
      {missingRows.length > 0 ? (
        <TouchableOpacity style={[card, { flexDirection: 'row', alignItems: 'center', gap: spacing.s, marginHorizontal: spacing.l, padding: spacing.m }]} onPress={() => setAllowMissing(!allowMissing)}>
          <Ionicons name={allowMissing ? 'checkbox' : 'square-outline'} size={20} color={allowMissing ? colors.accent : colors.textFaint} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 14 }}>允许缺失材料</Text>
            <Text style={{ color: colors.textFaint, fontSize: 11 }}>开启后仍可提交，缺失的部分等待补料</Text>
          </View>
        </TouchableOpacity>
      ) : null}

      {/* 分组清单 */}
      <FlatList
        data={sections}
        keyExtractor={(s) => s.title}
        renderItem={({ item: section }) => (
          <View style={{ paddingHorizontal: spacing.l, paddingTop: spacing.l }}>
            <Chip label={section.title} tone={section.tone} />
            {section.data.map((r) => (
              <View key={r.key} style={[card, rowStyles.row]}>
                <ItemIcon uri={r.icon} size={34} fluid={r.isFluid} fluidColor={r.fluidColor} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colors.text, fontSize: 13 }} numberOfLines={1}>
                    {r.dname}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    {r.missing > 0 ? <Text style={[rowStyles.num, { color: colors.bad }]}>缺失 {formatItemCount(r.missing)}</Text> : null}
                    {r.numberRemainingToCraft > 0 ? <Text style={[rowStyles.num, { color: colors.accent }]}>合成 {formatItemCount(r.numberRemainingToCraft)}</Text> : null}
                    {r.numberPresent > 0 ? <Text style={[rowStyles.num, { color: colors.ok }]}>已有 {formatItemCount(r.numberPresent)}</Text> : null}
                  </View>
                </View>
                <View style={{ width: 64 }}>
                  <ProgressBar
                    ratio={r.missing > 0 ? 0 : r.numberPresent / Math.max(1, r.numberPresent + r.numberRemainingToCraft)}
                    tone={r.missing > 0 ? colors.bad : colors.accent}
                  />
                </View>
              </View>
            ))}
          </View>
        )}
        ListEmptyComponent={<EmptyState icon="clipboard-outline" title="空计划" />}
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
      />

      {/* 提交 */}
      <View style={styles.footer}>
        <PrimaryButton
          label={submitting ? '正在提交…' : canCraft ? '确认开始合成' : '材料缺失，无法合成'}
          icon="play"
          onPress={submit}
          disabled={!canCraft || cpuId == null || submitting}
          loading={submitting}
        />
      </View>

      {/* CPU 选择弹层 */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.mask}>
          {/* 遮罩和面板必须平级：套在一起时，滑动列表会被当成「点遮罩」直接关掉弹层 */}
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setPickerOpen(false)} />
          <View style={styles.sheet}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs }}>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>选择合成 CPU</Text>
              <TouchableOpacity
                style={[styles.autoBtn, !autoCpu && { opacity: 0.4 }]}
                disabled={!autoCpu}
                onPress={() => {
                  setManual(false);
                  setPickerOpen(false);
                }}
              >
                <Ionicons name="flash" size={14} color={colors.accent} />
                <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '600' }}>自动分配</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ color: colors.textFaint, fontSize: 11, marginBottom: spacing.s }}>
              本次任务需要 {formatItemCount(needBytes)} 字节。自动分配会从上往下选第一台「空闲且装得下」的 CPU。
            </Text>

            {sortedAll.length === 0 ? (
              <Text style={{ color: colors.textFaint, fontSize: 13 }}>
                {cpusLoaded ? '网络里没有合成 CPU。' : '正在获取 CPU 列表…'}
              </Text>
            ) : (
              // 必须能滚动：大网络里 CPU 数量可能几十台，不滚会把标题和「自动分配」顶出屏幕
              <ScrollView
                style={{ maxHeight: Dimensions.get('window').height * 0.55 }}
                contentContainerStyle={{ gap: spacing.s, paddingBottom: spacing.s }}
                showsVerticalScrollIndicator
              >
                {sortedAll.map((c) => {
                const st = statusOf(c);
                const disabled = st !== 'ok';
                const active = cpuId === c.idx;
                return (
                  <TouchableOpacity
                    key={c.idx}
                    disabled={disabled}
                    style={[
                      styles.cpuRow,
                      active && { borderColor: colors.accent, backgroundColor: colors.accentSoft },
                      disabled && { opacity: 0.45 },
                    ]}
                    onPress={() => {
                      setManual(true);
                      setCpuId(c.idx);
                      setPickerOpen(false);
                    }}
                  >
                    <Ionicons
                      name={st === 'busy' ? 'time-outline' : st === 'small' ? 'alert-circle-outline' : 'hardware-chip'}
                      size={18}
                      color={st === 'ok' ? (active ? colors.accent : colors.textDim) : colors.bad}
                    />
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s }}>
                        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
                          #{c.idx} {c.cpuName}
                        </Text>
                        {st !== 'ok' ? (
                          <Text style={{ color: colors.bad, fontSize: 10, fontWeight: '700' }}>{STATUS_LABEL[st]}</Text>
                        ) : active && !manual ? (
                          <Text style={{ color: colors.accent, fontSize: 10, fontWeight: '700' }}>自动</Text>
                        ) : null}
                      </View>
                      <Text style={{ color: colors.textFaint, fontSize: 11 }} numberOfLines={1}>
                        容量 {formatItemCount(c.storage)} · 并行 {c.parallelism}
                        {st === 'busy' && c.item ? ` · 正在合成 ${c.item}` : ''}
                        {st === 'small' ? ` · 差 ${formatItemCount(needBytes - c.storage)}` : ''}
                      </Text>
                    </View>
                    {active ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
                  </TouchableOpacity>
                );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    padding: spacing.m,
    marginTop: spacing.s,
  },
  num: { fontSize: 11, fontWeight: '600' },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  footer: { padding: spacing.l, backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border },
  mask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.l,
    borderTopRightRadius: radius.l,
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.s,
  },
  autoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.m,
    paddingVertical: 6,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  cpuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    padding: spacing.m,
    backgroundColor: colors.surfaceAlt,
  },
});
