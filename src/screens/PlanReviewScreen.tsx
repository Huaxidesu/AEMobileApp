// 合成计划确认：分组展示 + 选择 CPU + 提交
import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { Ionicons } from '@expo/vector-icons';
import { useConfig } from '../config';
import { CraftPlan, CraftingCPUInfo, formatItemCount, getJson, postForm } from '../api';
import { resolveItem } from '../db';
import { readCache, scopeKey, writeCache } from '../cache';
import { colors, radius, spacing, card } from '../theme';
import { Chip, EmptyState, ItemIcon, PrimaryButton, ProgressBar } from '../components';
import { showToast } from '../toast';

interface Row {
  key: string;
  icon: string | null;
  dname: string | null;
  missing: number;
  numberPresent: number;
  numberRemainingToCraft: number;
  name: string;
  meta: number;
  nbt?: string | null;
}

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

  const [cpus, setCpus] = useState<CraftingCPUInfo[]>([]);
  const [cpuId, setCpuId] = useState<number | null>(null);
  const [allowMissing, setAllowMissing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canCraft = missingRows.length === 0 || allowMissing;

  // 与合成监控共用同一份 CPU 列表缓存
  const cacheKey = `cpus:${scopeKey(config)}`;
  const usableCpus = (list: CraftingCPUInfo[]) => list.filter((c) => c.storage > plan.bytesUsed && c.item == null);

  useEffect(() => {
    let alive = true;
    readCache<CraftingCPUInfo[]>(cacheKey).then((hit) => {
      if (!alive || !hit) return;
      setCpus((prev) => (prev.length > 0 ? prev : usableCpus(hit.data)));
    });
    return () => {
      alive = false;
    };
  }, [cacheKey]);

  useEffect(() => {
    let alive = true;
    getJson<CraftingCPUInfo[]>(config, '/AE2/getCraftingCpuInfoNoSSE', {
      ownerUUID: config.uuid,
      ...(config.mainnet ?? {}),
    })
      .then((resp) => {
        if (!alive || !resp.succeed) return;
        const all = resp.body ?? [];
        writeCache(cacheKey, all);
        const usable = usableCpus(all);
        setCpus(usable);
        if (usable.length === 0) showToast('没有空闲且容量足够的合成 CPU', 'bad');
      })
      .catch(() => {
        // 取不到实时列表时保留缓存结果，提交阶段仍会由服务器校验
        if (alive) showToast('获取 CPU 列表失败，显示的是缓存数据', 'bad');
      });
    return () => {
      alive = false;
    };
  }, []);

  async function submit() {
    if (cpuId == null) {
      showToast('请先选择一个合成 CPU', 'bad');
      return;
    }
    setSubmitting(true);
    try {
      const resp = await postForm<string>(config, '/AE2/startCraftingJob', {
        ownerUUID: config.uuid,
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

  const selectedCpu = cpus.find((c) => c.idx === cpuId);

  return (
    <View style={styles.screen}>
      {/* 目标摘要 */}
      <View style={[card, { flexDirection: 'row', alignItems: 'center', gap: spacing.m, margin: spacing.l, marginBottom: 0, padding: spacing.m }]}>
        <ItemIcon uri={request.icon} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>
            {request.dname ?? request.item}
          </Text>
          <Text style={{ color: colors.textDim, fontSize: 12 }}>× {formatItemCount(request.count)} · 占用 {formatItemCount(plan.bytesUsed)} 字节</Text>
        </View>
      </View>

      {/* CPU 选择 */}
      <TouchableOpacity style={[card, { margin: spacing.l, padding: spacing.m }]} onPress={() => setPickerOpen(true)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s }}>
            <Ionicons name="hardware-chip" size={18} color={colors.accent} />
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>
              {selectedCpu ? `CPU #${selectedCpu.idx} · ${selectedCpu.cpuName}` : cpus.length > 0 ? '选择合成 CPU' : '没有可用的 CPU'}
            </Text>
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
                <ItemIcon uri={r.icon} size={34} />
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
        <TouchableOpacity style={styles.mask} activeOpacity={1} onPress={() => setPickerOpen(false)}>
          <View style={styles.sheet}>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: spacing.m }}>选择合成 CPU</Text>
            {cpus.length === 0 ? (
              <Text style={{ color: colors.textFaint, fontSize: 13 }}>没有空闲且容量足够的 CPU。可关闭此页后等待任务完成。</Text>
            ) : (
              cpus.map((c) => (
                <TouchableOpacity
                  key={c.idx}
                  style={[styles.cpuRow, cpuId === c.idx && { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}
                  onPress={() => {
                    setCpuId(c.idx);
                    setPickerOpen(false);
                  }}
                >
                  <Ionicons name="hardware-chip" size={18} color={cpuId === c.idx ? colors.accent : colors.textDim} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>
                      #{c.idx} {c.cpuName}
                    </Text>
                    <Text style={{ color: colors.textFaint, fontSize: 11 }}>{formatItemCount(c.storage)} 字节 · 并行 {c.parallelism}</Text>
                  </View>
                  {cpuId === c.idx ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
                </TouchableOpacity>
              ))
            )}
          </View>
        </TouchableOpacity>
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
