// 服务器与账号：多账号（连接预设）+ 线路选择 + 主网 + 保存
import React, { useEffect, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useConfig } from '../config';
import { AENetwork, DEFAULT_PORT, baseUrl, getJson, testConnection } from '../api';
import {
  ServerAccount,
  accountLabel,
  accountSummary,
  createAccount,
  deleteAccount,
  getActiveAccount,
  getActiveAccountId,
  loadAccounts,
  setActiveAccountId,
  upsertAccount,
} from '../accounts';
import { ServerEntry, entryForHost, fetchServerList, loadCachedServerList, mergeServers } from '../serverlist';
import { readCache, serverKey, writeCache } from '../cache';
import { colors, radius, spacing, card } from '../theme';
import { Chip, FieldLabel, GhostButton, PrimaryButton, Segmented, SettingsGroup, StatusDot, StyledInput } from '../components';
import { showToast } from '../toast';

export default function ServerSettingsScreen({ navigation }: any) {
  const { reload } = useConfig();

  const [accounts, setAccounts] = useState<ServerAccount[]>(() => loadAccounts());
  const [activeId, setActiveId] = useState<string>(() => getActiveAccountId());

  // 表单只服务于「当前编辑的账号」，切换账号时整体换掉
  const [name, setName] = useState('');
  const [scheme, setScheme] = useState('http');
  const [ip, setIp] = useState('');
  const [port, setPort] = useState(DEFAULT_PORT);
  const [uuid, setUuid] = useState('');
  const [mainnet, setMainnet] = useState<AENetwork | null>(null);

  const [lines, setLines] = useState<ServerEntry[]>(() => mergeServers([]));
  const [lineOpen, setLineOpen] = useState(false);
  const [refreshingLines, setRefreshingLines] = useState(false);
  const [networks, setNetworks] = useState<AENetwork[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 网络列表与主网选择无关，按服务器指纹单独缓存
  const netKey = `networks:${serverKey({ scheme, ip, port, uuid, mainnet: null })}`;

  function applyForm(acc: ServerAccount) {
    setName(acc.name);
    setScheme(acc.scheme);
    setIp(acc.ip);
    setPort(acc.port);
    setUuid(acc.uuid);
    setMainnet(acc.mainnet);
    setTested(null);
  }

  function formAccount(): ServerAccount {
    return { id: activeId, name, scheme, ip, port, uuid, mainnet, updatedAt: Date.now() };
  }

  useEffect(() => {
    applyForm(getActiveAccount());
    loadCachedServerList().then((hit) => {
      if (hit) setLines(mergeServers(hit.entries));
    });
    refreshLines(true);
  }, []);

  /** 拉一次在线线路；silent=true 时不打扰玩家（进入页面时的后台刷新） */
  async function refreshLines(silent = false) {
    setRefreshingLines(true);
    try {
      const entries = await fetchServerList();
      setLines(mergeServers(entries));
      if (!silent) showToast(`已更新 ${entries.length} 条在线线路`, 'ok');
    } catch (e: any) {
      if (!silent) showToast(e?.message ?? '获取在线线路失败', 'bad');
    } finally {
      setRefreshingLines(false);
    }
  }

  function switchAccount(target: ServerAccount) {
    if (target.id === activeId) return;
    // 切走前把当前表单落盘，避免改了密码没点保存就丢
    upsertAccount(formAccount());
    setActiveAccountId(target.id);
    setActiveId(target.id);
    setAccounts(loadAccounts());
    applyForm(target);
    reload();
  }

  function addAccount() {
    upsertAccount(formAccount());
    const acc = createAccount({ scheme: 'http', port: DEFAULT_PORT, uuid: '', mainnet: null });
    setActiveAccountId(acc.id);
    setActiveId(acc.id);
    setAccounts(loadAccounts());
    applyForm(acc);
    reload();
    showToast('已新建账号，填好密码后保存', 'info');
  }

  function removeAccount() {
    if (accounts.length <= 1) {
      showToast('至少要保留一个账号', 'bad');
      return;
    }
    Alert.alert('删除账号', `确定删除「${accountLabel(accounts.find((a) => a.id === activeId) ?? accounts[0])}」吗？密码与主网会一起删除。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          deleteAccount(activeId);
          const list = loadAccounts();
          const nextId = getActiveAccountId();
          setAccounts(list);
          setActiveId(nextId);
          applyForm(list.find((a) => a.id === nextId) ?? list[0]);
          reload();
          showToast('账号已删除', 'ok');
        },
      },
    ]);
  }

  async function openLinePicker() {
    setLineOpen(true);
    // 打开时顺手用缓存里的在线列表刷新一次（在线源可能已更新）
    const hit = await loadCachedServerList();
    if (hit) setLines(mergeServers(hit.entries));
  }

  async function fetchNetworks() {
    if (!ip || !uuid) {
      showToast('请先填写服务器地址和密码', 'bad');
      return;
    }
    try {
      const resp = await getJson<AENetwork[]>({ scheme, ip, port, uuid, mainnet }, '/AE2/getNetworks', { ownerUUID: uuid });
      if (!resp.succeed) {
        showToast(resp.message ?? '获取网络列表失败', 'bad');
        return;
      }
      const list = resp.body ?? [];
      if (list.length === 0) {
        showToast('你还没在 ME 控制器旁放置监控器', 'bad');
        return;
      }
      writeCache(netKey, list);
      setNetworks(list);
      setPickerOpen(true);
    } catch {
      const hit = await readCache<AENetwork[]>(netKey);
      if (hit && hit.data.length > 0) {
        setNetworks(hit.data);
        setPickerOpen(true);
        showToast('连不上服务器，显示的是缓存的网络列表', 'bad');
      } else {
        showToast('无法连接服务器，先试试"测试连接"', 'bad');
      }
    }
  }

  async function runTest() {
    if (!ip) {
      showToast('请先填写服务器地址', 'bad');
      return;
    }
    setTesting(true);
    const okScheme = await testConnection(ip, port);
    setTesting(false);
    if (okScheme) {
      setScheme(okScheme);
      setTested(okScheme);
      showToast(`${okScheme.toUpperCase()} 连接成功`, 'ok');
    } else {
      setTested(null);
      showToast('连接失败，请检查地址、端口和防火墙', 'bad');
    }
  }

  async function save() {
    if (!ip || !uuid) {
      showToast('服务器地址和密码不能为空', 'bad');
      return;
    }
    if (!mainnet) {
      showToast('请先获取并选择主网', 'bad');
      return;
    }
    setSaving(true);
    const acc = upsertAccount(formAccount());
    setActiveAccountId(acc.id);
    setAccounts(loadAccounts());
    await reload();
    setSaving(false);
    showToast('设置已保存', 'ok');
    if (navigation.canGoBack()) navigation.goBack();
  }

  const currentLine = entryForHost(ip, port, lines);
  // 首次配置时这页是根路由；从设置里进来才需要返回按钮。用 canGoBack 判断，
  // 不能只看 complete——切换到还没配好的账号时它也会是 false。
  const isSetup = !navigation.canGoBack?.();

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ padding: spacing.l, paddingBottom: spacing.xxl }}>
        {isSetup ? (
          <View style={{ marginBottom: spacing.l }}>
            <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800' }}>连接服务器</Text>
            <Text style={{ color: colors.textFaint, fontSize: 11, marginTop: 2 }}>首次使用需要先完成这一步</Text>
          </View>
        ) : null}

        {isSetup ? (
          <View style={[card, { padding: spacing.l, marginBottom: spacing.l, borderColor: colors.accent }]}>
            <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 14 }}>首次使用</Text>
            <Text style={{ color: colors.textDim, fontSize: 12, marginTop: 4, lineHeight: 18 }}>
              在游戏里的 ME 控制器旁放置「AE 监控器」，聊天栏会给出访问密码。选一条线路、填上密码，获取网络并选择主网即可。
            </Text>
          </View>
        ) : null}

        {/* 账号 */}
        <SettingsGroup title="账号" footnote="每个账号保存一套地址、密码与主网，点一下即切换；保存后立刻生效">
          {accounts.map((acc, i) => {
            const active = acc.id === activeId;
            return (
              <TouchableOpacity
                key={acc.id}
                style={[styles.accRow, i < accounts.length - 1 && styles.divider]}
                activeOpacity={0.7}
                onPress={() => switchAccount(acc)}
              >
                <Ionicons
                  name={active ? 'radio-button-on' : 'radio-button-off'}
                  size={18}
                  color={active ? colors.accent : colors.textFaint}
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
                    {accountLabel(acc)}
                  </Text>
                  <Text style={{ color: colors.textFaint, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
                    {accountSummary(acc)}
                  </Text>
                </View>
                {active ? <Chip label="使用中" tone="accent" /> : null}
              </TouchableOpacity>
            );
          })}
          <View style={{ flexDirection: 'row', gap: spacing.s, padding: spacing.m }}>
            <View style={{ flex: 1 }}>
              <GhostButton label="新建账号" icon="add" onPress={addAccount} />
            </View>
            <View style={{ flex: 1 }}>
              <GhostButton label="删除当前" icon="trash" onPress={removeAccount} disabled={accounts.length <= 1} />
            </View>
          </View>
        </SettingsGroup>

        {/* 登录 */}
        <SettingsGroup title="登录">
          <View style={{ padding: spacing.m, gap: spacing.m }}>
            <View>
              <FieldLabel text="账号名称（可选，留空用线路名）" />
              <StyledInput value={name} onChangeText={setName} placeholder="例如 主号 / 小号" autoCorrect={false} />
            </View>

            <Segmented
              options={[
                { key: 'http', label: 'HTTP' },
                { key: 'https', label: 'HTTPS' },
              ]}
              value={scheme}
              onChange={setScheme}
            />

            <View>
              <FieldLabel text="线路" />
              <TouchableOpacity style={styles.lineRow} activeOpacity={0.7} onPress={openLinePicker}>
                <Ionicons name="git-branch" size={16} color={colors.accent2} />
                <Text style={{ color: currentLine ? colors.text : colors.textDim, fontSize: 14, flex: 1 }} numberOfLines={1}>
                  {currentLine ? currentLine.name : '自定义地址'}
                </Text>
                {currentLine?.tag ? <Chip label={currentLine.tag} tone="neutral" /> : null}
                <Ionicons name="chevron-down" size={16} color={colors.textFaint} />
              </TouchableOpacity>
            </View>

            <View>
              <FieldLabel text="服务器地址（不带端口）" />
              <StyledInput value={ip} onChangeText={setIp} placeholder="例如 mc.dafeimao.net" autoCorrect={false} />
            </View>
            <View>
              <FieldLabel text="端口（mod 默认 44444）" />
              <StyledInput value={port} onChangeText={setPort} keyboardType="number-pad" />
            </View>
            <View>
              <FieldLabel text="访问密码（UUID 首段）" />
              <StyledInput value={uuid} onChangeText={setUuid} placeholder="放置监控器后从聊天栏获取" secure />
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.m }}>
              <View style={{ flex: 1 }}>
                <GhostButton label={testing ? '测试中…' : '测试连接'} icon="pulse" onPress={runTest} disabled={testing} />
              </View>
              {tested ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <StatusDot ok />
                  <Text style={{ color: colors.ok, fontSize: 12 }}>{tested.toUpperCase()} 就绪</Text>
                </View>
              ) : null}
            </View>
          </View>
        </SettingsGroup>

        {/* 主网 */}
        <SettingsGroup title="主网" footnote="监控器方块所在的 ME 网络，一般只有一个">
          <View style={{ padding: spacing.m, gap: spacing.m }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s }}>
              <Ionicons name="git-network" size={18} color={colors.accent2} />
              {mainnet && mainnet.x != null ? (
                <Text style={{ color: colors.text, fontSize: 14, flex: 1 }}>
                  DIM {mainnet.dimid} · ({mainnet.x}, {mainnet.y}, {mainnet.z})
                </Text>
              ) : (
                <Text style={{ color: colors.textFaint, fontSize: 14, flex: 1 }}>未选择</Text>
              )}
            </View>
            <GhostButton label="获取网络列表并选择" icon="download" onPress={fetchNetworks} />
            <Text style={{ color: colors.textFaint, fontSize: 11 }}>
              当前连接：{baseUrl({ scheme, ip, port, uuid, mainnet }) || '未配置'}
            </Text>
          </View>
        </SettingsGroup>

        <PrimaryButton label={saving ? '保存中…' : '保存设置'} icon="checkmark" onPress={save} loading={saving} />
      </ScrollView>

      {/* 线路选择弹层 */}
      <Modal visible={lineOpen} transparent animationType="slide" onRequestClose={() => setLineOpen(false)}>
        <TouchableOpacity style={styles.mask} activeOpacity={1} onPress={() => setLineOpen(false)}>
          <View style={styles.sheet}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.m }}>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', flex: 1 }}>选择线路</Text>
              <TouchableOpacity onPress={() => refreshLines()} disabled={refreshingLines} style={styles.refreshBtn}>
                <Ionicons name="refresh" size={16} color={refreshingLines ? colors.textFaint : colors.accent} />
                <Text style={{ color: refreshingLines ? colors.textFaint : colors.accent, fontSize: 12, fontWeight: '600' }}>
                  {refreshingLines ? '获取中' : '更新在线列表'}
                </Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 380 }}>
              {lines.map((line) => {
                const selected = line.host === ip && line.port === port;
                return (
                  <TouchableOpacity
                    key={`${line.host}:${line.port}`}
                    style={[styles.lineItem, selected && { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}
                    onPress={() => {
                      setIp(line.host);
                      setPort(line.port);
                      setLineOpen(false);
                    }}
                  >
                    <Ionicons name="server" size={18} color={selected ? colors.accent : colors.textDim} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
                        {line.name}
                      </Text>
                      <Text style={{ color: colors.textFaint, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
                        {line.host}:{line.port}
                      </Text>
                    </View>
                    {line.tag ? <Chip label={line.tag} tone="neutral" /> : null}
                    {line.source === 'online' ? <Chip label="在线" tone="accent2" /> : null}
                    {selected ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <Text style={{ color: colors.textFaint, fontSize: 11, marginTop: spacing.m, lineHeight: 16 }}>
              列表里没有的服务器，直接在上面「服务器地址」里手动填写。在线列表的地址可在设置 → 服务器列表里改。
            </Text>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 主网选择弹层 */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity style={styles.mask} activeOpacity={1} onPress={() => setPickerOpen(false)}>
          <View style={styles.sheet}>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: spacing.m }}>选择主网（一般只有一个）</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {networks.map((n, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.lineItem, mainnet === n && { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}
                  onPress={() => {
                    setMainnet(n);
                    setPickerOpen(false);
                  }}
                >
                  <Ionicons name="git-network" size={18} color={colors.accent2} />
                  <Text style={{ color: colors.text, fontSize: 14, flex: 1 }}>
                    DIM {n.dimid} · ({n.x}, {n.y}, {n.z})
                  </Text>
                  {mainnet === n ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  accRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.m, paddingHorizontal: spacing.m, paddingVertical: 12 },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingHorizontal: spacing.m,
    paddingVertical: 11,
  },
  lineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    padding: spacing.m,
    marginBottom: spacing.s,
    backgroundColor: colors.surfaceAlt,
  },
  refreshBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 6 },
  mask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.l,
    borderTopRightRadius: radius.l,
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
  },
});
