// 物品详情 + 发起合成计划（服务端分片模拟，边算边回进度）
import React, { useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useConfig } from '../config';
import { CraftPlan, formatItemCount, request } from '../api';
import { resolveItem } from '../db';
import { themedStyles, useTheme, radius, spacing, card } from '../theme';
import { Chip, FieldLabel, ItemIcon, PrimaryButton, GhostButton, StyledInput } from '../components';
import { showToast } from '../toast';

const QUICK_COUNTS = [1, 64, 512, 4096];
/** 流体按 mB 下单，1 B = 1000 mB（游戏里 AE 流体终端也是这么显示的） */
const FLUID_COUNTS = [1000, 16000, 72000, 144000];
/** 源质（神秘时代要素）按「个」下单，一个样板通常产出个位数 */
const ESSENTIA_COUNTS = [1, 8, 64, 256];

export default function ItemDetailScreen({ route, navigation }: any) {
  const { colors } = useTheme();
  const db = useSQLiteContext();
  const { config } = useConfig();
  const raw = route.params.item as { item_name?: string; name?: string; meta: number; nbt?: string; count: number; craftable: boolean };
  const itemName = raw.name ?? raw.item_name ?? '';
  const resolved = useMemo(() => resolveItem(db, { name: itemName, meta: raw.meta, nbt: raw.nbt }), [raw]);
  const isFluid = resolved.isFluid === true;
  const isEssentia = resolved.isEssentia === true;
  const quickCounts = isFluid ? FLUID_COUNTS : isEssentia ? ESSENTIA_COUNTS : QUICK_COUNTS;
  const [countText, setCountText] = useState(isFluid ? '1000' : isEssentia ? '16' : '64');
  const [calculating, setCalculating] = useState(false);
  const [resolvedCount, setResolvedCount] = useState(0);
  /** 用户中途返回：结果回来时直接丢弃，不要再跳页 */
  const abandonedRef = useRef(false);

  const count = parseInt(countText, 10);

  async function generate() {
    if (Number.isNaN(count) || count <= 0) {
      showToast('请输入正确的合成数量', 'bad');
      return;
    }
    // 流体按 mB、源质按个，数量本来就大，不该套物品的上限
    if (!isFluid && !isEssentia && count > 50000) {
      showToast('数量太大了，为了防止打崩服务器，除流体/要素外不能下这么大的单子', 'bad');
      return;
    }
    setCalculating(true);
    setResolvedCount(0);
    abandonedRef.current = false;
    try {
      // 服务端分片跑模拟，每片回一条进度（body 是 "SIMULATING - resolved: N"）
      const resp = await request<CraftPlan>(
        config,
        'plan',
        {
          ...(config.mainnet ?? {}),
          item: resolved.original_name ?? resolved.name,
          meta: resolved.original_meta ?? resolved.meta,
          nbt: resolved.nbt ?? '',
          count,
        },
        (body) => {
          const m = /resolved:\s*(\d+)/.exec(String(body));
          if (m) setResolvedCount(parseInt(m[1], 10));
        },
      );
      if (abandonedRef.current) return;
      if (!resp.succeed) {
        // 3.0.0 起服务端 populatePlan 用 IAEStackList，流体配方不再抛 ClassCastException，
        // 所以这里不再有「涉及流体 = 已知限制」的说法；只兜底别的类型错误，别把 Java 堆栈甩给玩家
        const rawMsg = resp.message ?? '生成合成计划失败';
        const msg = /cannot be cast to|ClassCastException/.test(rawMsg)
          ? '服务端计算这个配方时出错了（内部类型错误），请把这条反馈给服务器管理员'
          : rawMsg;
        showToast(msg, 'bad');
        return;
      }
      const plan = resp.body;
      plan.plan.sort((a, b) => b.missing - a.missing);
      navigation.navigate('PlanReview', {
        plan,
        request: {
          item: resolved.original_name ?? resolved.name,
          meta: resolved.original_meta ?? resolved.meta,
          nbt: resolved.nbt ?? '',
          count,
          dname: resolved.dname,
          icon: resolved.icon,
        },
      });
    } catch {
      if (!abandonedRef.current) showToast('获取合成计划失败，请检查连接', 'bad');
    } finally {
      if (!abandonedRef.current) setCalculating(false);
    }
  }

  function goBack() {
    if (calculating) {
      Alert.alert('注意', '返回将放弃正在生成的合成计划', [
        { text: '继续等待', style: 'cancel' },
        { text: '放弃', style: 'destructive', onPress: () => { abandonedRef.current = true; setCalculating(false); navigation.goBack(); } },
      ]);
    } else {
      navigation.goBack();
    }
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ padding: spacing.l, gap: spacing.m }}>
        <View style={[card, { alignItems: 'center', padding: spacing.xl, gap: spacing.m }]}>
          <ItemIcon uri={resolved.icon} size={80} fluid={resolved.isFluid} fluidColor={resolved.fluidColor} tint={resolved.aspectTint} />
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700', textAlign: 'center' }}>{resolved.dname ?? resolved.name}</Text>
          <View style={{ flexDirection: 'row', gap: spacing.s, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Chip label={`当前存量 ${formatItemCount(raw.count)}${isFluid ? ' mB' : ''}`} tone="accent" icon="cube-outline" />
            {raw.craftable ? <Chip label="可合成" tone="ok" icon="hammer" /> : <Chip label="不可合成" tone="neutral" />}
            {isFluid ? <Chip label="流体" tone="accent2" icon="water" /> : null}
            {isEssentia ? <Chip label="源质要素" tone="accent2" icon="flask" /> : null}
          </View>
          <Text style={{ color: colors.textFaint, fontSize: 11 }}>
            {resolved.original_name ? `${resolved.original_name} → ` : ''}
            {resolved.name}:{resolved.meta}
          </Text>
        </View>

        <View>
          <FieldLabel text={isFluid ? '合成数量（mB）' : isEssentia ? '合成数量（个）' : '合成数量'} />
          <StyledInput value={countText} onChangeText={setCountText} keyboardType="number-pad" placeholder="输入数量" />
          <View style={{ flexDirection: 'row', gap: spacing.s, marginTop: spacing.s }}>
            {quickCounts.map((c) => (
              <TouchableOpacity key={c} style={styles.quick} onPress={() => setCountText(String(c))}>
                <Text style={styles.quickText}>{isFluid ? `${formatItemCount(c / 1000)}B` : `×${c}`}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {isFluid ? (
            <Text style={{ color: colors.textFaint, fontSize: 11, marginTop: spacing.s }}>
              流体按 mB 下单，1 B = 1000 mB（游戏里 AE 流体终端也是这个单位）。
            </Text>
          ) : null}
          {isEssentia ? (
            <Text style={{ color: colors.textFaint, fontSize: 11, marginTop: spacing.s }}>
              源质要素走神秘时代的要素样板（比如 Aer = 2 个风之碎片），能不能下单看服务器里有没有对应样板。
            </Text>
          ) : null}
        </View>

        {calculating ? (
          <View style={[card, { gap: spacing.s, alignItems: 'center', padding: spacing.xl }]}>
            <Text style={{ color: colors.accent, fontSize: 15, fontWeight: '700' }}>正在计算合成计划…</Text>
            <Text style={{ color: colors.textDim, fontSize: 13 }}>已解析 {resolvedCount} 个步骤</Text>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: spacing.s }}>
            <View style={{ flex: 1 }}>
              <GhostButton label="返回" icon="chevron-back" onPress={goBack} />
            </View>
            <View style={{ flex: 2 }}>
              <PrimaryButton label="生成合成计划" icon="arrow-forward" onPress={generate} disabled={resolved.name === ''} />
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = themedStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  quick: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: radius.s,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickText: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
}));
