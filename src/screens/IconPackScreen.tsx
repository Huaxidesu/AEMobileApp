// 图标库：查看当前库、配置更新源、检查更新 / 下载安装 / 恢复内置
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, card } from '../theme';
import { GhostButton, PrimaryButton, SettingsGroup, StyledInput } from '../components';
import { formatBytes } from '../cache';
import { showToast } from '../toast';
import {
  downloadAndInstall,
  fetchManifest,
  getInstalledInfoFor,
  getManifestUrl,
  hasUpdate,
  isCustomManifestUrl,
  isValidManifestUrl,
  PACK_KINDS,
  PACK_LABEL,
  packInfo,
  pendingKinds,
  RemoteManifest,
  restoreAllBuiltin,
  setManifestUrl,
} from '../iconpack';

export default function IconPackScreen() {
  const [installed, setInstalled] = useState(() => PACK_KINDS.map(getInstalledInfoFor));
  const [urlText, setUrlText] = useState(getManifestUrl());
  const [savedUrl, setSavedUrl] = useState(getManifestUrl());
  const [custom, setCustom] = useState(isCustomManifestUrl());
  const [manifest, setManifest] = useState<RemoteManifest | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);

  /** 保存输入框里的更新源；返回实际生效地址，格式不对返回 null */
  function applyUrl(): string | null {
    if (!isValidManifestUrl(urlText)) {
      showToast('更新源地址要以 http:// 或 https:// 开头', 'bad');
      return null;
    }
    const effective = setManifestUrl(urlText);
    setUrlText(effective);
    setSavedUrl(effective);
    setCustom(isCustomManifestUrl());
    return effective;
  }

  function resetUrl() {
    const effective = setManifestUrl('');
    setUrlText(effective);
    setSavedUrl(effective);
    setCustom(false);
    showToast('已恢复默认更新源', 'ok');
  }

  async function checkIcons() {
    // 顺手保存输入框：改完地址直接点检查更新即可
    const url = applyUrl();
    if (!url) return;
    setChecking(true);
    try {
      const m = await fetchManifest(url);
      setManifest(m);
      const pending = pendingKinds(m);
      showToast(
        pending.length
          ? `发现更新：${pending.map((k) => PACK_LABEL[k]).join('、')}库`
          : '三个库都已是最新',
        'ok',
      );
    } catch (e: any) {
      showToast(e?.message ?? '检查更新失败', 'bad');
    } finally {
      setChecking(false);
    }
  }

  async function installIcons() {
    if (!manifest) return;
    setInstalling(true);
    setProgress(0);
    try {
      const { updated, version } = await downloadAndInstall(manifest, { onProgress: (r) => setProgress(r) });
      setInstalled(PACK_KINDS.map(getInstalledInfoFor));
      showToast(
        updated.length ? `已更新 ${updated.map((k) => PACK_LABEL[k]).join('、')}库（${version}）` : '没有需要更新的库',
        'ok',
      );
    } catch (e: any) {
      showToast(e?.message ?? '更新失败', 'bad');
    } finally {
      setInstalling(false);
      setProgress(0);
    }
  }

  function restoreIcons() {
    restoreAllBuiltin();
    setInstalled(PACK_KINDS.map(getInstalledInfoFor));
    showToast('三个库都已恢复内置', 'ok');
  }

  const updateAvailable = manifest ? hasUpdate(manifest) : false;
  const pending = manifest ? pendingKinds(manifest) : [];

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ padding: spacing.l, paddingBottom: spacing.xxl }}>
        {/* 三个库各自的版本 */}
        <View style={[card, { padding: spacing.m, marginBottom: spacing.l, gap: spacing.s }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.m }}>
            <View style={styles.iconBox}>
              <Ionicons name="images" size={18} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>图标库</Text>
              <Text style={{ color: colors.textFaint, fontSize: 11, marginTop: 2 }}>
                物品 / 流体 / 源质 三个库分开更新，只下载变了的那一个
              </Text>
            </View>
          </View>
          {PACK_KINDS.map((kind, i) => {
            const info = installed[i];
            const remote = manifest ? packInfo(manifest, kind) : null;
            const isPending = pending.includes(kind);
            return (
              <View
                key={kind}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s, marginTop: 2 }}
              >
                <Text style={{ color: colors.textDim, fontSize: 12, width: 34 }}>{PACK_LABEL[kind]}</Text>
                <Text style={{ color: colors.text, fontSize: 12, flex: 1 }}>
                  {info.version ? `在线 ${info.version}` : '内置'}
                  {info.size ? ` · ${formatBytes(info.size)}` : ''}
                </Text>
                {isPending && remote ? (
                  <Text style={{ color: colors.accent, fontSize: 11 }}>可更新 → {remote.version}</Text>
                ) : null}
              </View>
            );
          })}
          <Text style={{ color: colors.textFaint, fontSize: 11, lineHeight: 16, marginTop: spacing.s }}>
            {manifest
              ? `远端 ${manifest.updated}${manifest.note ? ` · ${manifest.note}` : ''}`
              : '换 GTNH 版本不必重装 APK，只比对 sha256，不按版本号排序。'}
          </Text>
        </View>

        {/* 更新源 */}
        <SettingsGroup
          title="更新源"
          footnote="填目录或 version.json 都行；Gitea 的 /src/branch/ 网页地址会自动换成 raw 直链。"
        >
          <View style={{ padding: spacing.m, gap: spacing.m }}>
            <StyledInput value={urlText} onChangeText={setUrlText} placeholder="https://…/ae/version.json" multiline />
            <View style={{ flexDirection: 'row', gap: spacing.s }}>
              <View style={{ flex: 1 }}>
                <GhostButton label="保存地址" icon="save" onPress={() => applyUrl() && showToast('更新源已保存', 'ok')} disabled={installing} />
              </View>
              <View style={{ flex: 1 }}>
                <GhostButton label="恢复默认" icon="refresh" onPress={resetUrl} disabled={installing || !custom} />
              </View>
            </View>
            <Text style={{ color: colors.textFaint, fontSize: 11 }} numberOfLines={2}>
              生效地址：{savedUrl}
            </Text>
          </View>
        </SettingsGroup>

        {/* 操作 */}
        <SettingsGroup title="更新">
          <View style={{ padding: spacing.m, gap: spacing.m }}>
            {installing ? (
              <View style={{ gap: 6 }}>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: 'hidden' }}>
                  <View style={{ height: 6, width: `${Math.max(2, Math.round(progress * 100))}%`, backgroundColor: colors.accent }} />
                </View>
                <Text style={{ color: colors.textFaint, fontSize: 11 }}>下载中 {Math.round(progress * 100)}%</Text>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: spacing.s }}>
              <View style={{ flex: 1 }}>
                <GhostButton
                  label={checking ? '检查中…' : '检查更新'}
                  icon="cloud-download"
                  onPress={checkIcons}
                  disabled={installing || checking}
                />
              </View>
              {updateAvailable ? (
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
            {installed.some((i) => i.version) ? (
              <TouchableOpacity onPress={restoreIcons} disabled={installing} style={[styles.dangerRow, installing && { opacity: 0.4 }]}>
                <Ionicons name="refresh" size={16} color={colors.textDim} />
                <Text style={{ color: colors.textDim, fontSize: 14, fontWeight: '600' }}>恢复内置图标库</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </SettingsGroup>

        <Text style={styles.hint}>
          在线库下载后落在 App 私有目录，装完当次生效、无需重启；想腾空间可在「数据缓存」里删掉在线库回到内置版。
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: radius.s,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  dangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  hint: { color: colors.textFaint, fontSize: 11, lineHeight: 17, marginTop: spacing.s, marginHorizontal: spacing.xs },
});
