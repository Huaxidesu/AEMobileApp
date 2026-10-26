// 设置总览：连接 / 内容 / 存储 / 关于。具体配置都在各自的子页里
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useConfig } from '../config';
import { baseUrl } from '../api';
import { formatBytes, summarizeCache } from '../cache';
import { getInstalledInfo, getOnlinePackBytes } from '../iconpack';
import { BUILTIN_SERVERS, getServerListUrl, loadCachedServerList } from '../serverlist';
import { shortUrlLabel } from '../urlutil';
import { APP_VERSION } from '../appinfo';
import { colors, spacing } from '../theme';
import { SettingsGroup, SettingsRow, StatusDot } from '../components';

export default function SettingsScreen({ navigation }: any) {
  const { config, complete, accountName } = useConfig();
  const [cacheBytes, setCacheBytes] = useState<number | null>(null);
  const [cacheCount, setCacheCount] = useState(0);
  const [iconVersion, setIconVersion] = useState<string | null>(getInstalledInfo().version);
  const [packBytes, setPackBytes] = useState<number | null>(null);
  const [onlineLines, setOnlineLines] = useState(0);

  // 从子页返回时刷新：清理缓存、装完图标库、改了在线列表都会变
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      summarizeCache().then((s) => {
        if (!alive) return;
        setCacheBytes(s.total);
        setCacheCount(s.count);
      });
      getOnlinePackBytes().then((b) => alive && setPackBytes(b));
      loadCachedServerList().then((hit) => alive && setOnlineLines(hit ? hit.entries.length : 0));
      setIconVersion(getInstalledInfo().version);
      return () => {
        alive = false;
      };
    }, []),
  );

  const net = config.mainnet;
  const mainnetText = net ? `DIM ${net.dimid} · (${net.x}, ${net.y}, ${net.z})` : '未选择主网';

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>设置</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <StatusDot ok={complete} />
          <Text style={styles.subtitle}>{complete ? `${accountName} · ${baseUrl(config)}` : '未配置服务器'}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.l, paddingBottom: spacing.xxl }}>
        <SettingsGroup title="连接" footnote="多账号：每个账号保存一套地址、密码与主网，切换即换服务器">
          <SettingsRow
            icon="person-circle"
            label="账号与主网"
            detail={complete ? `${accountName}\n${baseUrl(config)} · ${mainnetText}` : '填写地址与密码后获取网络列表'}
            onPress={() => navigation.navigate('ServerSettings')}
          />
          <SettingsRow
            icon="server"
            label="服务器列表"
            value={`内置 ${BUILTIN_SERVERS.length} · 在线 ${onlineLines}`}
            detail={shortUrlLabel(getServerListUrl())}
            onPress={() => navigation.navigate('ServerList')}
            divider={false}
          />
        </SettingsGroup>

        <SettingsGroup title="内容">
          <SettingsRow
            icon="images"
            label="图标库"
            value={iconVersion ? `在线 ${iconVersion}` : '内置'}
            detail={packBytes ? `在线包占用 ${formatBytes(packBytes)} · 可换更新源` : '随安装包分发 · 可换更新源'}
            onPress={() => navigation.navigate('IconPack')}
            divider={false}
          />
        </SettingsGroup>

        <SettingsGroup title="存储">
          <SettingsRow
            icon="save"
            label="数据缓存"
            value={cacheBytes != null ? formatBytes(cacheBytes) : '—'}
            detail={`${cacheCount} 个文件 · 物品/合成/监控的离线副本，可清理`}
            onPress={() => navigation.navigate('CacheDetail')}
            divider={false}
          />
        </SettingsGroup>

        <SettingsGroup title="其他">
          <SettingsRow
            icon="information-circle-outline"
            label="关于"
            value={`v${APP_VERSION}`}
            onPress={() => navigation.navigate('About')}
            divider={false}
          />
        </SettingsGroup>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.l,
    paddingTop: spacing.l,
    paddingBottom: spacing.s,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: '800' },
  subtitle: { color: colors.textFaint, fontSize: 11 },
});
