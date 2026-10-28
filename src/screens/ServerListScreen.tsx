// 服务器列表：内置线路一览 + 在线列表的地址配置与手动更新
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { themedStyles, useTheme, radius, spacing, card } from '../theme';
import { Chip, GhostButton, PrimaryButton, SettingsGroup, StyledInput } from '../components';
import { formatAgo } from '../cache';
import { showToast } from '../toast';
import {
  BUILTIN_SERVERS,
  DEFAULT_SERVER_LIST_URL,
  ServerEntry,
  fetchServerList,
  getServerListUrl,
  isCustomServerListUrl,
  isValidServerListUrl,
  loadCachedServerList,
  mergeServers,
  setServerListUrl,
} from '../serverlist';
import { prettyUrl } from '../urlutil';

export default function ServerListScreen() {
  const { colors } = useTheme();
  const [entries, setEntries] = useState<ServerEntry[]>(() => mergeServers([]));
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [urlText, setUrlText] = useState(getServerListUrl());
  const [savedUrl, setSavedUrl] = useState(getServerListUrl());
  const [custom, setCustom] = useState(isCustomServerListUrl());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadCachedServerList().then((hit) => {
      if (!hit) return;
      setEntries(mergeServers(hit.entries));
      setCachedAt(hit.at);
    });
  }, []);

  /** 保存输入框里的地址；返回实际生效地址，格式不对返回 null */
  function applyUrl(): string | null {
    if (!isValidServerListUrl(urlText)) {
      showToast('地址要以 http:// 或 https:// 开头', 'bad');
      return null;
    }
    const effective = setServerListUrl(urlText);
    setUrlText(effective);
    setSavedUrl(effective);
    setCustom(isCustomServerListUrl());
    return effective;
  }

  function resetUrl() {
    const effective = setServerListUrl('');
    setUrlText(effective);
    setSavedUrl(effective);
    setCustom(false);
    showToast('已恢复默认列表地址', 'ok');
  }

  async function refresh() {
    const url = applyUrl();
    if (!url) return;
    setBusy(true);
    try {
      const list = await fetchServerList(url);
      setEntries(mergeServers(list));
      setCachedAt(Date.now());
      showToast(`已获取 ${list.length} 条在线线路`, 'ok');
    } catch (e: any) {
      showToast(e?.message ?? '获取在线列表失败', 'bad');
    } finally {
      setBusy(false);
    }
  }

  const onlineCount = entries.filter((e) => e.source === 'online').length;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ padding: spacing.l, paddingBottom: spacing.xxl }}>
        <View style={[card, { padding: spacing.m, marginBottom: spacing.l, gap: spacing.s }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.m }}>
            <View style={styles.iconBox}>
              <Ionicons name="server" size={18} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>
                内置 {BUILTIN_SERVERS.length} 条 · 在线 {onlineCount} 条
              </Text>
              <Text style={{ color: colors.textFaint, fontSize: 11, marginTop: 2 }}>
                {cachedAt ? `在线列表更新于 ${formatAgo(cachedAt)}` : '还没获取过在线列表，用的只有内置线路'}
              </Text>
            </View>
          </View>
        </View>

        <SettingsGroup title="在线列表地址" footnote="填目录或 servers.json 都行；Gitea 的 /src/branch/ 网页地址会自动换成 raw 直链。">
          <View style={{ padding: spacing.m, gap: spacing.m }}>
            <StyledInput value={urlText} onChangeText={setUrlText} placeholder="https://…/ae/servers.json" multiline />
            <View style={{ flexDirection: 'row', gap: spacing.s }}>
              <View style={{ flex: 1 }}>
                <GhostButton label="保存地址" icon="save" onPress={() => applyUrl() && showToast('列表地址已保存', 'ok')} disabled={busy} />
              </View>
              <View style={{ flex: 1 }}>
                <GhostButton label="恢复默认" icon="refresh" onPress={resetUrl} disabled={busy || !custom} />
              </View>
            </View>
            <Text style={{ color: colors.textFaint, fontSize: 11 }} numberOfLines={2}>
              生效地址：{prettyUrl(savedUrl)}
            </Text>
          </View>
        </SettingsGroup>

        <SettingsGroup title="线路一览" footnote="同 host:port 的条目以在线列表为准（运营可以改线路名/备注）">
          {entries.map((e, i) => (
            <View key={`${e.host}:${e.port}`} style={[styles.row, i < entries.length - 1 && styles.divider]}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
                    {e.name}
                  </Text>
                  {e.tag ? <Chip label={e.tag} tone="neutral" /> : null}
                </View>
                <Text style={{ color: colors.textFaint, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
                  {e.host}:{e.port}
                </Text>
              </View>
              <Chip label={e.source === 'online' ? '在线' : '内置'} tone={e.source === 'online' ? 'accent2' : 'neutral'} />
            </View>
          ))}
        </SettingsGroup>

        <PrimaryButton label={busy ? '获取中…' : '立即更新在线列表'} icon="cloud-download" onPress={refresh} loading={busy} />

        <Text style={styles.hint}>
          默认地址 {prettyUrl(DEFAULT_SERVER_LIST_URL)}。列表只影响「服务器与账号」页的线路选择，不会改动已保存账号的地址；
          离线时沿用上次获取的列表。
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = themedStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: radius.s,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.m, paddingHorizontal: spacing.m, paddingVertical: 12 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  hint: { color: colors.textFaint, fontSize: 11, lineHeight: 17, marginTop: spacing.m, marginHorizontal: spacing.xs },
}));
