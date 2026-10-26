// 设置总览：连接 / 内容 / 存储 / 关于。具体配置都在各自的子页里
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useConfig } from '../config';
import { baseUrl } from '../api';
import { formatBytes, summarizeCache } from '../cache';
import { getInstalledInfo, getOnlinePackBytes } from '../iconpack';
import { APP_VERSION } from '../appinfo';
import { colors, spacing } from '../theme';
import { SettingsGroup, SettingsRow, StatusDot } from '../components';

export default function SettingsScreen({ navigation }: any) {
  const { config, complete } = useConfig();
  const [cacheBytes, setCacheBytes] = useState<number | null>(null);
  const [cacheCount, setCacheCount] = useState(0);
  const [iconVersion, setIconVersion] = useState<string | null>(getInstalledInfo().version);
  const [packBytes, setPackBytes] = useState<number | null>(null);

  // 从子页返回时刷新占用：清理缓存、装完图标库都会变
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      summarizeCache().then((s) => {
        if (!alive) return;
        setCacheBytes(s.total);
        setCacheCount(s.count);
      });
      getOnlinePackBytes().then((b) => alive && setPackBytes(b));
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
          <Text style={styles.subtitle}>{complete ? baseUrl(config) : '未配置服务器'}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.l, paddingBottom: spacing.xxl }}>
        <SettingsGroup title="连接" footnote="服务器地址、访问密码与主网都在同一个页面里配置">
          <SettingsRow
            icon="server"
            label="服务器与主网"
            detail={complete ? `${baseUrl(config)}\n${mainnetText}` : '填写地址与密码后获取网络列表'}
            onPress={() => navigation.navigate('ServerSettings')}
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
