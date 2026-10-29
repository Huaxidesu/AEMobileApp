// 设置总览：连接 / 内容 / 存储 / 关于。具体配置都在各自的子页里
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useConfig } from '../config';
import { useChat } from '../chat';
import { baseUrl } from '../api';
import { formatBytes, summarizeCache } from '../cache';
import { getInstalledInfo, getOnlinePackBytes } from '../iconpack';
import { BUILTIN_SERVERS, getServerListUrl, loadCachedServerList } from '../serverlist';
import { shortUrlLabel } from '../urlutil';
import { APP_VERSION } from '../appinfo';
import { themedStyles, useTheme, spacing } from '../theme';
import { SettingsGroup, SettingsRow, StatusDot } from '../components';
import { useGrid } from '../gridprefs';

export default function SettingsScreen({ navigation }: any) {
  const { colors, mode } = useTheme();
  const { prefs, pageSize, setMode } = useGrid();
  const paged = prefs.mode === 'page';
  const { config, complete, accountName } = useConfig();
  const { name: chatName } = useChat();
  const insets = useSafeAreaInsets();
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
      <View style={[styles.header, { paddingTop: spacing.l + insets.top }]}>
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

        <SettingsGroup title="外观" footnote="主题与网格布局改完立刻生效，不用重启">
          <SettingsRow
            icon="grid-outline"
            label="界面布局"
            value={`${prefs.columns} 列 × ${prefs.rows} 行`}
            detail={paged ? `翻页 · 每页 ${pageSize} 个 · 物品页右上角也有同一个入口` : '无限下滑 · 物品页右上角也有同一个入口'}
            onPress={() => navigation.navigate('Layout')}
          />
          <SettingsRow
            icon="swap-vertical"
            label="翻页浏览"
            detail={paged ? '底部显示翻页条，点中间页码可跳到指定页' : '默认无限下滑，右下角一键到顶 / 到底'}
            onPress={() => setMode(paged ? 'scroll' : 'page')}
            right={
              <Switch
                value={paged}
                onValueChange={(v) => setMode(v ? 'page' : 'scroll')}
                trackColor={{ false: colors.surfaceHigh, true: colors.accent }}
                thumbColor={paged ? colors.bg : colors.textDim}
              />
            }
          />
          <SettingsRow
            icon="color-palette"
            label="主题"
            value={mode === 'custom' ? '自定义' : mode === 'light' ? '浅色' : '深色'}
            detail="浅色 / 深色 / 自定义配色"
            onPress={() => navigation.navigate('Theme')}
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

        <SettingsGroup title="聊天" footnote="手机发言在游戏里显示为 [AEMobile][昵称]；游戏内公屏实时同步到手机，本地保留 7 天">
          <SettingsRow
            icon="chatbubbles-outline"
            label="聊天昵称"
            value={chatName || '未设置'}
            detail={chatName ? '点一下可以改，只影响显示' : '进聊天页时也可以设置'}
            onPress={() => navigation.navigate('ChatName')}
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

const styles = themedStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.l,
    paddingTop: spacing.l,
    paddingBottom: spacing.s,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: '800' },
  subtitle: { color: colors.textFaint, fontSize: 11 },
}));
