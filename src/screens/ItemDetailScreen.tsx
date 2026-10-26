// 物品详情 + 发起合成计划（SSE 进度）
import React, { useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import EventSource from 'react-native-sse';
import { useSQLiteContext } from 'expo-sqlite';
import { useConfig } from '../config';
import { CraftPlan, formatItemCount, openSSE } from '../api';
import { resolveItem } from '../db';
import { colors, radius, spacing, card } from '../theme';
import { Chip, FieldLabel, ItemIcon, PrimaryButton, GhostButton, StyledInput } from '../components';
import { showToast } from '../toast';

const QUICK_COUNTS = [1, 64, 512, 4096];

export default function ItemDetailScreen({ route, navigation }: any) {
  const db = useSQLiteContext();
  const { config } = useConfig();
  const raw = route.params.item as { item_name?: string; name?: string; meta: number; nbt?: string; count: number; craftable: boolean };
  const itemName = raw.name ?? raw.item_name ?? '';
  const resolved = useMemo(() => resolveItem(db, { name: itemName, meta: raw.meta, nbt: raw.nbt }), [raw]);
  const [countText, setCountText] = useState('64');
  const [calculating, setCalculating] = useState(false);
  const [resolvedCount, setResolvedCount] = useState(0);
  const esRef = useRef<EventSource | null>(null) as any;

  const isFluid = resolved.original_name != null;
  const count = parseInt(countText, 10);

  function generate() {
    if (Number.isNaN(count) || count <= 0) {
      showToast('请输入正确的合成数量', 'bad');
      return;
    }
    if (!isFluid && count > 50000) {
      showToast('数量太大了，为了防止打崩服务器，除流体外不能下这么大的单子', 'bad');
      return;
    }
    setCalculating(true);
    setResolvedCount(0);
    const es: EventSource = openSSE(
      config,
      '/AE2/generateCraftingPlan',
      { ownerUUID: config.uuid },
      {
        ownerUUID: config.uuid,
        ...(config.mainnet ?? {}),
        item: resolved.original_name ?? resolved.name,
        meta: String(resolved.original_meta ?? resolved.meta),
        nbt: resolved.nbt ?? '',
        count: String(count),
      },
    );
    esRef.current = es;
    es.addEventListener('message', (ev: any) => {
      let data: any;
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!data.succeed) {
        showToast(data.message ?? '生成合成计划失败', 'bad');
        es.close();
        setCalculating(false);
        return;
      }
      if (typeof data.body === 'string') {
        // 进度消息："SIMULATING - resolved: N"
        const m = /resolved:\s*(\d+)/.exec(data.body);
        if (m) setResolvedCount(parseInt(m[1], 10));
        return;
      }
      // 最终计划
      es.close();
      setCalculating(false);
      const plan: CraftPlan = data.body;
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
    });
    es.addEventListener('error', () => {
      es.close();
      setCalculating(false);
      showToast('获取合成计划失败，请检查连接', 'bad');
    });
  }

  function goBack() {
    if (calculating) {
      Alert.alert('注意', '返回将放弃正在生成的合成计划', [
        { text: '继续等待', style: 'cancel' },
        { text: '放弃', style: 'destructive', onPress: () => { esRef.current?.close(); setCalculating(false); navigation.goBack(); } },
      ]);
    } else {
      navigation.goBack();
    }
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ padding: spacing.l, gap: spacing.m }}>
        <View style={[card, { alignItems: 'center', padding: spacing.xl, gap: spacing.m }]}>
          <ItemIcon uri={resolved.icon} size={80} />
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700', textAlign: 'center' }}>{resolved.dname ?? resolved.name}</Text>
          <View style={{ flexDirection: 'row', gap: spacing.s, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Chip label={`当前存量 ${formatItemCount(raw.count)}`} tone="accent" icon="cube-outline" />
            {raw.craftable ? <Chip label="可合成" tone="ok" icon="hammer" /> : <Chip label="不可合成" tone="neutral" />}
            {isFluid ? <Chip label="流体" tone="accent2" icon="water" /> : null}
          </View>
          <Text style={{ color: colors.textFaint, fontSize: 11 }}>
            {resolved.original_name ? `${resolved.original_name} → ` : ''}
            {resolved.name}:{resolved.meta}
          </Text>
        </View>

        <View>
          <FieldLabel text="合成数量" />
          <StyledInput value={countText} onChangeText={setCountText} keyboardType="number-pad" placeholder="输入数量" />
          <View style={{ flexDirection: 'row', gap: spacing.s, marginTop: spacing.s }}>
            {QUICK_COUNTS.map((c) => (
              <TouchableOpacity key={c} style={styles.quick} onPress={() => setCountText(String(c))}>
                <Text style={styles.quickText}>×{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
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

const styles = StyleSheet.create({
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
});
