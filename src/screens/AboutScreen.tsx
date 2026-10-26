// 关于：版本、仓库地址、更新源与使用前提
import React from 'react';
import { Image, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { APP_VERSION, REPO_APP, REPO_MOD } from '../appinfo';
import { getManifestUrl } from '../iconpack';
import { colors, radius, spacing } from '../theme';
import { SettingsGroup, SettingsRow } from '../components';

export default function AboutScreen() {
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  logo: { width: 84, height: 84, borderRadius: radius.l },
  intro: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.xs,
  },
});
