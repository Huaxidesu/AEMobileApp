// 合成监控：CPU 列表 + 运行中任务详情 + 取消
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import EventSource from 'react-native-sse';
import { Ionicons } from '@expo/vector-icons';
import { useConfig } from '../config';
import { ApiResponse, CraftingCPUInfo, CraftTaskItem, formatItemCount, openSSE, postForm } from '../api';
import { resolveItem } from '../db';
import { formatAgo, readCache, scopeKey, writeCache } from '../cache';
import { colors, radius, spacing, card } from '../theme';
import { Chip, EmptyState, ItemIcon, PrimaryButton, StatusDot, ProgressBar, CenterLoading } from '../components';
import { showToast } from '../toast';

export default function CraftScreen() {
  const db = useSQLiteContext();
  const { config } = useConfig();
  const insets = useSafeAreaInsets();
  const [cpus, setCpus] = useState<CraftingCPUInfo[]>([]);
  const [connected, setConnected] = useState(false);
  const [detailCpu, setDetailCpu] = useState<CraftingCPUInfo | null>(null);
  /** 当前列表来自缓存的写入时间；收到实时帧后清空 */
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const liveRef = useRef(false);

  const cacheKey = `cpus:${scopeKey(config)}`;

  // 先读缓存：离线打开也能看到上次的 CPU 列表，联网后由 SSE 覆盖
  useEffect(() => {
    let alive = true;
    liveRef.current = false;
    readCache<CraftingCPUInfo[]>(cacheKey).then((hit) => {
      if (!alive || !hit || liveRef.current) return;
      setCpus(hit.data);
      setCachedAt(hit.at);
    });
    return () => {
      alive = false;
    };
  }, [cacheKey]);

  const connect = useCallback(() => {
    esRef.current?.close();
    if (!config.mainnet) return;
    const { dimid, x, y, z } = config.mainnet;
    const es: EventSource = openSSE(config, '/AE2/getCraftingCpuInfo', {
      ownerUUID: config.uuid,
      x, y, z, dimid,
    });
    esRef.current = es;
    es.addEventListener('message', (ev: any) => {
      try {
        const resp: ApiResponse<CraftingCPUInfo[]> = JSON.parse(ev.data);
        if (resp.succeed) {
          const list = resp.body ?? [];
          liveRef.current = true;
          setCpus(list);
          setCachedAt(null);
          setConnected(true);
          // 5s 一帧，限 20s 一次写盘
          writeCache(cacheKey, list, 20000);
        } else {
          es.close();
          setConnected(false);
        }
      } catch {}
    });
    es.addEventListener('error', () => setConnected(false));
  }, [config, cacheKey]);

  // 只在本页可见时连：SSE 每 5s 推一次 CPU 列表，切走就断
  useFocusEffect(
    useCallback(() => {
      connect();
      return () => {
        esRef.current?.close();
        esRef.current = null;
      };
    }, [connect]),
  );

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: spacing.l + insets.top }]}>
        <View>
          <Text style={styles.title}>合成监控</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <StatusDot ok={connected} />
            <Text style={styles.subtitle}>
              {connected
                ? `${cpus.filter((c) => c.item).length} 台 CPU 运行中`
                : cachedAt
                ? `离线缓存 · ${formatAgo(cachedAt)}`
                : '连接中…'}
            </Text>
          </View>
        </View>
        <TouchableOpacity onPress={connect} style={styles.refresh}>
          <Ionicons name="refresh" size={20} color={connected ? colors.textDim : colors.accent} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={cpus}
        keyExtractor={(c) => String(c.idx)}
        contentContainerStyle={{ padding: spacing.l, gap: spacing.m }}
        ListEmptyComponent={!connected ? <CenterLoading text="正在获取 CPU 状态…" /> : <EmptyState icon="hardware-chip-outline" title="没有合成 CPU" subtitle="检查主网设置，或在 ME 网络里加装合成 CPU" />}
        renderItem={({ item: cpu }) => {
          const busy = cpu.item != null;
          const resolved = busy ? resolveItem(db, { name: cpu.item!, meta: cpu.meta, nbt: cpu.nbt ?? undefined }) : null;
          return (
            <TouchableOpacity
              style={[card, { padding: spacing.m }]}
              activeOpacity={busy ? 0.7 : 1}
              onPress={() => busy && setDetailCpu(cpu)}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.m }}>
                {busy ? <ItemIcon uri={resolved?.icon ?? null} size={38} /> : <View style={idleStyles.idleBox}><Ionicons name="cafe" size={22} color={colors.textFaint} /></View>}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>
                    #{cpu.idx} {cpu.cpuName}
                  </Text>
                  {busy ? (
                    <Text style={{ color: colors.textDim, fontSize: 12 }} numberOfLines={1}>
                      {resolved?.dname ?? cpu.item} · 剩余 {formatItemCount(cpu.remainingCount)}
                    </Text>
                  ) : (
                    <Text style={{ color: colors.textFaint, fontSize: 12 }}>空闲中</Text>
                  )}
                </View>
                {busy ? <Chip label="运行中" tone="accent" icon="pulse" /> : <Chip label="空闲" tone="neutral" />}
              </View>
              {busy ? (
                <View style={{ marginTop: spacing.m }}>
                  <ProgressBar ratio={0.5} tone={colors.accent2} />
                </View>
              ) : null}
            </TouchableOpacity>
          );
        }}
      />

      {detailCpu ? (
        <CraftDetailModal
          cpu={detailCpu}
          onClose={() => {
            setDetailCpu(null);
            connect();
          }}
        />
      ) : null}
    </View>
  );
}

function CraftDetailModal({ cpu, onClose }: { cpu: CraftingCPUInfo; onClose: () => void }) {
  const db = useSQLiteContext();
  const { config } = useConfig();
  const [tasks, setTasks] = useState<CraftTaskItem[] | null>(null);
  const [dead, setDead] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const cacheKey = `details:${scopeKey(config)}#${cpu.idx}`;

  // 先铺上次的明细：连不上时至少能看到任务构成，而不是一直转圈
  useEffect(() => {
    let alive = true;
    setTasks(null);
    readCache<CraftTaskItem[]>(cacheKey).then((hit) => {
      if (!alive || !hit) return;
      setTasks((prev) => prev ?? hit.data);
    });
    return () => {
      alive = false;
    };
  }, [cacheKey]);

  useEffect(() => {
    if (!config.mainnet) return;
    const { dimid, x, y, z } = config.mainnet;
    const es: EventSource = openSSE(config, '/AE2/getCraftingDetails', {
      ownerUUID: config.uuid,
      x, y, z, dimid,
      cpuid: cpu.idx,
    });
    esRef.current = es;
    es.addEventListener('message', (ev: any) => {
      try {
        const resp: ApiResponse<CraftTaskItem[]> = JSON.parse(ev.data);
        if (resp.succeed) {
          const list = resp.body ?? [];
          setTasks(list);
          setDead(false);
          // 5s 一帧，限 20s 一次写盘
          writeCache(cacheKey, list, 20000);
        } else {
          setDead(true);
          es.close();
        }
      } catch {}
    });
    es.addEventListener('error', () => setDead(true));
    return () => es.close();
  }, [cpu.idx, cacheKey]);

  const sent = useMemo(() => (tasks ?? []).reduce((s, t) => s + t.numberSent, 0), [tasks]);
  const remaining = useMemo(() => (tasks ?? []).reduce((s, t) => s + t.numberRemainingToCraft, 0), [tasks]);
  const ratio = sent + remaining > 0 ? sent / (sent + remaining) : 0;

  function cancel() {
    Alert.alert('取消合成', `确定取消 CPU #${cpu.idx} 上的任务吗？已合成的部分会保留。`, [
      { text: '继续合成', style: 'cancel' },
      {
        text: '取消任务',
        style: 'destructive',
        onPress: async () => {
          try {
            await postForm(config, '/AE2/cancelTask', { ownerUUID: config.uuid, ...(config.mainnet ?? {}), cpuid: cpu.idx });
            showToast('任务已取消', 'ok');
          } catch {
            showToast('取消失败', 'bad');
          }
          onClose();
        },
      },
    ]);
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.mask}>
        <View style={styles.sheet}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: '800' }}>
              #{cpu.idx} {cpu.cpuName}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.textDim} />
            </TouchableOpacity>
          </View>

          <View style={{ gap: 6, marginTop: spacing.m }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.textDim, fontSize: 12 }}>已合成 {formatItemCount(sent)}</Text>
              <Text style={{ color: colors.textDim, fontSize: 12 }}>剩余 {formatItemCount(remaining)}</Text>
            </View>
            <ProgressBar ratio={ratio} height={8} />
          </View>

          <FlatList
            style={{ marginTop: spacing.m, flexGrow: 0 }}
            data={tasks ?? []}
            keyExtractor={(t, i) => `${t.name}:${t.meta}:${i}`}
            ListEmptyComponent={
              dead || tasks === null ? (
                <CenterLoading text={dead ? '任务已结束或连接断开' : '正在获取任务明细…'} />
              ) : (
                <EmptyState icon="checkmark-circle-outline" title="这台 CPU 空闲了" />
              )
            }
            renderItem={({ item: t }) => {
              const r = resolveItem(db, t);
              return (
                <View style={[card, { flexDirection: 'row', alignItems: 'center', gap: spacing.m, padding: spacing.m, marginTop: spacing.s }]}>
                  <ItemIcon uri={r.icon} size={32} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: 13 }} numberOfLines={1}>
                      {r.dname ?? t.name}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      {t.numberSent > 0 ? <Text style={{ color: colors.accent, fontSize: 11, fontWeight: '600' }}>合成中 {formatItemCount(t.numberSent)}</Text> : null}
                      {t.missing > 0 ? <Text style={{ color: colors.bad, fontSize: 11, fontWeight: '600' }}>缺失 {formatItemCount(t.missing)}</Text> : null}
                      {t.numberRemainingToCraft > 0 ? <Text style={{ color: colors.textDim, fontSize: 11 }}>剩余 {formatItemCount(t.numberRemainingToCraft)}</Text> : null}
                    </View>
                  </View>
                </View>
              );
            }}
          />

          <View style={{ marginTop: spacing.l }}>
            <PrimaryButton label="取消该任务" tone="bad" icon="stop" onPress={cancel} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const idleStyles = StyleSheet.create({
  idleBox: {
    width: 38,
    height: 38,
    borderRadius: radius.s,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.l,
    paddingTop: spacing.l,
    paddingBottom: spacing.s,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: '800' },
  subtitle: { color: colors.textFaint, fontSize: 11 },
  refresh: {
    width: 38,
    height: 38,
    borderRadius: radius.m,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  mask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.l,
    borderTopRightRadius: radius.l,
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
    maxHeight: '85%',
  },
});
