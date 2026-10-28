// 存储与缓存：查看各类缓存占用，清理数据缓存或在线图标库
import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { CACHE_CATEGORY_LABEL, CacheCategory, CacheSummary, clearCache, formatBytes, summarizeCache } from '../cache';
import { getInstalledInfo, getOnlinePackBytes, removeOnlinePacks } from '../iconpack';
import { themedStyles, useTheme, spacing, card } from '../theme';
import { GhostButton, PrimaryButton, SettingsGroup } from '../components';
import { showToast } from '../toast';

const ORDER: CacheCategory[] = ['items', 'cpus', 'details', 'mspt', 'networks', 'servers'];

export default function CacheScreen() {
  const { colors } = useTheme();
  const [summary, setSummary] = useState<CacheSummary | null>(null);
  const [packBytes, setPackBytes] = useState<number | null>(null);
  const [installed, setInstalled] = useState(getInstalledInfo());
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setSummary(await summarizeCache());
    setPackBytes(await getOnlinePackBytes());
    setInstalled(getInstalledInfo());
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  function confirmClearData() {
    Alert.alert(
      '清理数据缓存',
      '将删除服务器数据的离线副本（物品列表、合成 CPU、合成明细、监控曲线、网络列表）。下次联网会重新拉取，服务器配置不受影响。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清理',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            await clearCache();
            await refresh();
            setBusy(false);
            showToast('数据缓存已清空', 'ok');
          },
        },
      ],
    );
  }

  function confirmClearPacks() {
    Alert.alert(
      '清理在线图标库',
      '将切回随安装包分发的内置图标库，并删除已下载的在线库与临时文件。界面会重新加载一次。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清理',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            await removeOnlinePacks();
            await refresh();
            setBusy(false);
            showToast('已回到内置图标库', 'ok');
          },
        },
      ],
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ padding: spacing.l, paddingBottom: spacing.xxl }}>
        <View style={[card, { padding: spacing.l, marginBottom: spacing.l }]}>
          <Text style={{ color: colors.textFaint, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>数据缓存</Text>
          <Text style={{ color: colors.text, fontSize: 26, fontWeight: '800', marginTop: 4 }}>
            {summary ? formatBytes(summary.total) : '—'}
          </Text>
          <Text style={{ color: colors.textFaint, fontSize: 11, marginTop: 2 }}>
            {summary ? `${summary.count} 个缓存文件 · 冷启动与离线时先用它出内容` : '正在统计…'}
          </Text>
        </View>

        <SettingsGroup title="分类占用">
          {ORDER.map((cat, i) => {
            const bucket = summary?.byCategory[cat];
            return (
              <View key={cat} style={[styles.row, i < ORDER.length - 1 && styles.divider]}>
                <Text style={{ color: colors.text, fontSize: 14, flex: 1 }}>{CACHE_CATEGORY_LABEL[cat]}</Text>
                <Text style={{ color: colors.textFaint, fontSize: 11, marginRight: spacing.s }}>{bucket?.count ?? 0} 项</Text>
                <Text style={{ color: colors.textDim, fontSize: 13, width: 78, textAlign: 'right' }}>
                  {formatBytes(bucket?.bytes ?? 0)}
                </Text>
              </View>
            );
          })}
        </SettingsGroup>

        <SettingsGroup title="图标库文件">
          <View style={{ padding: spacing.m, gap: spacing.s }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontSize: 14, flex: 1 }}>在线库占用</Text>
              <Text style={{ color: colors.textDim, fontSize: 13 }}>{packBytes != null ? formatBytes(packBytes) : '—'}</Text>
            </View>
            <Text style={{ color: colors.textFaint, fontSize: 11, lineHeight: 16 }}>
              当前生效：{installed.version ? `在线版 ${installed.version}` : '内置版（随安装包）'}。
              内置库不占额外空间；在线库下载后存放在 App 私有目录，可随时删除回到内置版。
            </Text>
            <GhostButton
              label="清理在线图标库"
              icon="trash"
              onPress={confirmClearPacks}
              disabled={busy || !packBytes}
            />
          </View>
        </SettingsGroup>

        <PrimaryButton label={busy ? '清理中…' : '清空数据缓存'} tone="bad" icon="trash" onPress={confirmClearData} loading={busy} />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.l, marginHorizontal: spacing.xs }}>
          <Ionicons name="information-circle-outline" size={13} color={colors.textFaint} />
          <Text style={{ color: colors.textFaint, fontSize: 11, flex: 1, lineHeight: 16 }}>
            缓存按「服务器 + 主网」分开存放，切换服务器不会串数据；服务器地址与密码保存在安全存储里，清理缓存不会丢失。
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = themedStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.m, paddingVertical: 12 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
}));
