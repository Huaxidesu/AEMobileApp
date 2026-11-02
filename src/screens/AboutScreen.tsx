// 关于：版本、仓库地址、更新源与使用前提
import React, { useState } from 'react';
import { Alert, Image, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { APP_VERSION, REPO_APP, REPO_MOD } from '../appinfo';
import { checkAppUpdate } from '../appupdate';
import { getManifestUrl } from '../iconpack';
import { showToast } from '../toast';
import { themedStyles, useTheme, radius, spacing } from '../theme';
import { SettingsGroup, SettingsRow } from '../components';

export default function AboutScreen() {
  const { colors } = useTheme();
  const [checking, setChecking] = useState(false);

  /**
   * 检查 App 更新。
   *
   * 只提示、不自己下载安装：Android 装 APK 要过系统安装器，应用内下载还得处理
   * FileProvider 和未知来源授权，收益不大 —— 交给浏览器下载，点开就能装。
   */
  const onCheck = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const up = await checkAppUpdate();
      if (!up) {
        showToast(`已是最新版本 v${APP_VERSION}`, 'ok');
        return;
      }
      const size = up.size ? `安装包 ${(up.size / 1048576).toFixed(0)} MB` : '';
      const body = [up.notes.slice(0, 300), size].filter(Boolean).join('\n\n') || '有新版本可以下载。';
      Alert.alert(`发现新版本 v${up.version}`, body, [
        { text: '稍后', style: 'cancel' },
        { text: up.apk ? '下载安装包' : '打开下载页', onPress: () => Linking.openURL(up.apk ?? up.page) },
      ]);
    } catch {
      showToast('检查失败：网络或 GitHub 不可达', 'bad');
    } finally {
      setChecking(false);
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ padding: spacing.l, paddingBottom: spacing.xxl }}>
        <View style={{ alignItems: 'center', gap: spacing.s, marginBottom: spacing.xl }}>
          <Image source={require('../../assets/icon.png')} style={styles.logo} resizeMode="contain" />
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800' }}>AEMobile</Text>
          <Text style={{ color: colors.textFaint, fontSize: 12 }}>v{APP_VERSION} · GTNH AE 网络远程监控</Text>
        </View>

        <Text style={styles.intro}>
          连接安装了 AEMobile mod 的 Minecraft 服务器，在手机上查看 AE2 网络物品、生成并提交合成计划、监控合成 CPU 与服务器 tick。
          App 不依赖 mod 的网页界面，只需要 44444 端口可达。
        </Text>

        <SettingsGroup title="版本" footnote="从 GitHub Release 取最新版，只比对版本号。">
          <SettingsRow
            icon="cloud-download-outline"
            label={checking ? '正在检查…' : '检查更新'}
            detail={`v${APP_VERSION}`}
            onPress={onCheck}
            divider={false}
          />
        </SettingsGroup>

        <SettingsGroup title="仓库">
          <SettingsRow
            icon="logo-github"
            label="手机端"
            detail={REPO_APP.replace('https://', '')}
            onPress={() => Linking.openURL(REPO_APP)}
          />
          <SettingsRow
            icon="server"
            label="服务端 mod"
            detail={REPO_MOD.replace('https://', '')}
            onPress={() => Linking.openURL(REPO_MOD)}
            divider={false}
          />
        </SettingsGroup>

        <SettingsGroup title="数据" footnote="图标库只比对 sha256，可在「图标库」里换更新源。">
          <SettingsRow
            icon="cloud-download"
            label="图标库更新源"
            detail={getManifestUrl().replace(/^https?:\/\//, '')}
            onPress={() => Linking.openURL(getManifestUrl())}
            divider={false}
          />
        </SettingsGroup>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginHorizontal: spacing.xs }}>
          <Ionicons name="information-circle-outline" size={13} color={colors.textFaint} style={{ marginTop: 2 }} />
          <Text style={{ color: colors.textFaint, fontSize: 11, flex: 1, lineHeight: 16 }}>
            物品图标与显示名来自本地图标库，不经过服务器；服务器只提供物品数量、合成与监控数据。
            两个仓库均为开源项目，许可协议见各自仓库的 LICENSE。
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = themedStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  logo: { width: 84, height: 84, borderRadius: radius.l },
  intro: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.xs,
  },
}));
