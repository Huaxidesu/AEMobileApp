// 设置：服务器连接 + 主网选择 + 测试连接 + 保存
import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useConfig } from '../config';
import { AENetwork, baseUrl, getJson, saveConfig, testConnection } from '../api';
import { colors, radius, spacing, card } from '../theme';
import { Chip, FieldLabel, GhostButton, PrimaryButton, Segmented, StatusDot, StyledInput } from '../components';
import { showToast } from '../toast';
import {
  downloadAndInstall,
  fetchManifest,
  getInstalledInfo,
  hasUpdate,
  RemoteManifest,
  restoreBuiltin,
} from '../iconpack';

function mb(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function SettingsScreen({ navigation }: any) {
  const { config, reload, complete } = useConfig();
  const [scheme, setScheme] = useState(config.scheme);
  const [ip, setIp] = useState(config.ip);
  const [port, setPort] = useState(config.port);
  const [uuid, setUuid] = useState(config.uuid);
  const [mainnet, setMainnet] = useState<AENetwork | null>(config.mainnet);
  const [networks, setNetworks] = useState<AENetwork[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [installed, setInstalled] = useState(getInstalledInfo());
  const [manifest, setManifest] = useState<RemoteManifest | null>(null);
  const [checkingIcons, setCheckingIcons] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    setScheme(config.scheme);
    setIp(config.ip);
    setPort(config.port);
    setUuid(config.uuid);
    setMainnet(config.mainnet);
  }, []);

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
      if ((resp.body ?? []).length === 0) {
        showToast('你还没在 ME 控制器旁放置监控器', 'bad');
        return;
      }
      setNetworks(resp.body ?? []);
      setPickerOpen(true);
    } catch {
      showToast('无法连接服务器，先试试"测试连接"', 'bad');
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
    await saveConfig({ scheme, ip, port, uuid, mainnet });
    await reload();
    setSaving(false);
    showToast('设置已保存', 'ok');
    if (navigation.canGoBack()) navigation.goBack();
  }

  async function checkIcons() {
    setCheckingIcons(true);
    try {
      const m = await fetchManifest();
      setManifest(m);
      showToast(hasUpdate(m) ? `发现新图标库 ${m.icons.version}` : '图标库已是最新', 'ok');
    } catch (e: any) {
      showToast(e?.message ?? '检查更新失败', 'bad');
    } finally {
      setCheckingIcons(false);
    }
  }

  async function installIcons() {
    if (!manifest) return;
    setInstalling(true);
    setProgress(0);
    try {
      const { version } = await downloadAndInstall(manifest, { onProgress: (r) => setProgress(r) });
      setInstalled(getInstalledInfo());
      showToast(`图标库已更新到 ${version}`, 'ok');
    } catch (e: any) {
      showToast(e?.message ?? '更新失败', 'bad');
    } finally {
      setInstalling(false);
      setProgress(0);
    }
  }

  function restoreIcons() {
    restoreBuiltin();
    setInstalled(getInstalledInfo());
    showToast('已恢复内置图标库', 'ok');
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ padding: spacing.l, paddingBottom: spacing.xxl }}>
        {!complete ? (
          <View style={[card, { padding: spacing.l, marginBottom: spacing.m, borderColor: colors.accent }]}>
            <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 14 }}>首次使用</Text>
            <Text style={{ color: colors.textDim, fontSize: 12, marginTop: 4, lineHeight: 18 }}>
              在游戏里的 ME 控制器旁放置「AE 监控器」，聊天栏会给出访问密码。填入服务器地址和密码，获取网络并选择主网即可。
            </Text>
          </View>
        ) : null}

        <Text style={styles.section}>服务器连接</Text>
        <View style={[card, { gap: spacing.m }]}>
          <Segmented
            options={[
              { key: 'http', label: 'HTTP' },
              { key: 'https', label: 'HTTPS' },
            ]}
            value={scheme}
            onChange={setScheme}
          />
          <View>
            <FieldLabel text="服务器地址（不带端口）" />
            <StyledInput value={ip} onChangeText={setIp} placeholder="例如 192.168.1.10" autoCorrect={false} />
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

        <Text style={styles.section}>主网</Text>
        <View style={[card, { gap: spacing.m }]}>
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

        <View style={{ marginTop: spacing.xl }}>
          <PrimaryButton label={saving ? '保存中…' : '保存设置'} icon="checkmark" onPress={save} loading={saving} />
        </View>

        <Text style={[styles.section, { marginTop: spacing.xl }]}>图标库</Text>
        <View style={[card, { gap: spacing.m }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s }}>
            <Ionicons name="images" size={18} color={colors.accent2} />
            <Text style={{ color: colors.text, fontSize: 14, flex: 1 }}>
              {installed.version ? `在线版 ${installed.version}` : '内置版（随安装包）'}
            </Text>
            <Text style={{ color: colors.textFaint, fontSize: 11 }}>{installed.size ? mb(installed.size) : ''}</Text>
          </View>
          <Text style={{ color: colors.textFaint, fontSize: 11, lineHeight: 16 }}>
            {manifest
              ? `远端 ${manifest.icons.version} · ${mb(manifest.icons.size)} · ${manifest.icons.rows} 条` +
                (manifest.note ? `\n${manifest.note}` : '')
              : '图标库可在线更新，以后换 GTNH 版本不必重装 APK'}
          </Text>
          {installing ? (
            <View style={{ gap: 4 }}>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: 'hidden' }}>
                <View
                  style={{
                    height: 6,
                    width: `${Math.max(2, Math.round(progress * 100))}%`,
                    backgroundColor: colors.accent,
                  }}
                />
              </View>
              <Text style={{ color: colors.textFaint, fontSize: 11 }}>下载中 {Math.round(progress * 100)}%</Text>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: spacing.s }}>
            <View style={{ flex: 1 }}>
              <GhostButton
                label={checkingIcons ? '检查中…' : '检查更新'}
                icon="cloud-download"
                onPress={checkIcons}
                disabled={installing || checkingIcons}
              />
            </View>
            {manifest && hasUpdate(manifest) ? (
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  label={installing ? '安装中…' : '下载并安装'}
                  icon="download"
                  onPress={installIcons}
                  loading={installing}
                />
              </View>
            ) : null}
          </View>
          {installed.version ? (
            <GhostButton label="恢复内置图标库" icon="refresh" onPress={restoreIcons} disabled={installing} />
          ) : null}
        </View>

        <Text style={[styles.section, { marginTop: spacing.xl }]}>关于</Text>
        <View style={[card, { gap: spacing.s }]}>
          <Text style={{ color: colors.textDim, fontSize: 12, lineHeight: 18 }}>
            AEMobile v2.0.2 · GTNH AE 网络远程监控{'\n'}
            服务端：github.com/koiNoCirculation/AEMobile{'\n'}
            手机端：github.com/koiNoCirculation/AEMobileApp
          </Text>
        </View>
      </ScrollView>

      {/* 主网选择弹层 */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity style={styles.mask} activeOpacity={1} onPress={() => setPickerOpen(false)}>
          <View style={styles.sheet}>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: spacing.m }}>选择主网（一般只有一个）</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {networks.map((n, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.netRow, mainnet === n && { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}
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
  section: { color: colors.textFaint, fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: spacing.s, marginTop: spacing.l },
  mask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.l,
    borderTopRightRadius: radius.l,
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  netRow: {
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
});
