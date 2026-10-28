// 首次配置页：App 不内置图标库，也没有默认服务器 —— 第一次打开时在这里把两件事做掉。
//
// 两条路：
//   1) 从配置包导入（服主给的一个 zip，里面是服务器地址 + 图标源）
//   2) 手动填图标源地址，下载完直接进主界面
import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '../theme';
import { GhostButton, PrimaryButton, StyledInput } from '../components';
import { showToast } from '../toast';
import { importBundleFromPicker } from '../bundle';
import { downloadAndInstall, fetchManifest, getManifestUrl, normalizeManifestUrl, setManifestUrl } from '../iconpack';

export default function SetupScreen({ onDone }: { onDone: () => void }) {
  const [url, setUrl] = useState(getManifestUrl());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [importing, setImporting] = useState(false);

  async function download() {
    const target = normalizeManifestUrl(url);
    if (!target) {
      showToast('先填图标源地址（服主会给）', 'bad');
      return;
    }
    setBusy(true);
    setProgress(0);
    try {
      setManifestUrl(target);
      const manifest = await fetchManifest(target);
      await downloadAndInstall(manifest, { onProgress: (r) => setProgress(r) });
      showToast('图标库已就绪', 'ok');
      onDone();
    } catch (e: any) {
      showToast(e?.message ?? '下载失败', 'bad');
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  async function importBundle() {
    setImporting(true);
    try {
      const r = await importBundleFromPicker();
      if (!r) return;
      setUrl(getManifestUrl());
      showToast(
        r.iconSourceApplied
          ? '配置已导入，接着下载图标库就行'
          : '配置已导入，但这个包里没有图标源地址',
        'ok',
      );
    } catch (e: any) {
      showToast(e?.message ?? '导入失败', 'bad');
    } finally {
      setImporting(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.l, gap: spacing.l }}>
        <View style={{ alignItems: 'center', gap: spacing.m, marginTop: spacing.xl }}>
          <Ionicons name="cube" size={56} color={colors.accent} />
          <Text style={styles.title}>首次使用</Text>
          <Text style={styles.subtitle}>
            App 不内置图标库，也没有预设服务器。{'\n'}
            用服主给的配置包，或手动填图标源地址。
          </Text>
        </View>

        {/* 方式一：配置包 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>方式一：导入配置包</Text>
          <Text style={styles.cardBody}>
            服主会发一个 .zip，里面包含服务器地址、线路列表和图标源。导入后所有设置一次到位。
          </Text>
          <GhostButton
            label={importing ? '导入中…' : '选择配置文件（.zip）'}
            icon="download-outline"
            onPress={importBundle}
          />
        </View>

        {/* 方式二：手填图标源 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>方式二：填图标源地址</Text>
          <Text style={styles.cardBody}>
            就是图标库的 version.json 地址（服主提供）。第一次要下载物品库（约 186MB），
            之后只下变化的部分。
          </Text>
          <StyledInput
            value={url}
            onChangeText={setUrl}
            placeholder="https://你的服务器/ae/version.json"
            autoCorrect={false}
          />
          <PrimaryButton
            label={busy ? `下载中 ${Math.round(progress * 100)}%` : '下载图标库并进入'}
            icon="cloud-download-outline"
            onPress={download}
            loading={busy}
          />
          {busy ? (
            <View style={styles.progressRow}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.progressText}>首次下载较大，请保持前台</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.hint}>
          服务器地址、线路、图标源以后都能在「设置」里改。图标是各模组的艺术作品，不随安装包分发。
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  title: { color: colors.text, fontSize: 22, fontWeight: '700' },
  subtitle: { color: colors.textDim, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    padding: spacing.m,
    gap: spacing.m,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  cardBody: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  progressText: { color: colors.textFaint, fontSize: 11 },
  hint: { color: colors.textFaint, fontSize: 11, lineHeight: 17, marginTop: spacing.m },
});
