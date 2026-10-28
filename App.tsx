import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider } from 'expo-sqlite';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import RootNavigator from './src/navigation';
import { ConfigProvider, useConfig } from './src/config';
import { ToastHost } from './src/toast';
import { colors, spacing } from './src/theme';
import { BUILTIN_DB, resolveActiveDb, subscribeActiveDb } from './src/iconpack';
import { clearDbCaches } from './src/db';
import { attachAux, ensureAuxDbs } from './src/dbs';

export default function App() {
  // 图标库可能被在线更新替换过：数据库名存 SecureStore，切换后靠 key 重新挂载 Provider
  const [dbName, setDbName] = useState<string | null>(null);
  /** 首帧 UI 出来之前一直盖着启动页，避免 SQLite 打开/导入期间露出空白 */
  const [booted, setBooted] = useState(false);
  /**
   * 图标字体必须显式预加载。
   * @expo/vector-icons 是在**第一次渲染某个图标时**才去加载 ttf 的，
   * 所以底栏会出现「先有文字、几百毫秒后图标才冒出来」的闪烁。
   */
  const [fontsReady, fontError] = useFonts(Ionicons.font);
  /** fluids.db / essentia.db 就位后才能打开主库（要在同一个连接上 ATTACH） */
  const [auxReady, setAuxReady] = useState(false);

  useEffect(() => {
    ensureAuxDbs()
      .catch(() => {})
      .then(() => setAuxReady(true));
  }, []);

  const refresh = useCallback(() => {
    resolveActiveDb()
      .then((name) => {
        clearDbCaches();
        setDbName(name);
      })
      .catch(() => setDbName(BUILTIN_DB));
  }, []);

  useEffect(() => {
    refresh();
    return subscribeActiveDb(refresh);
  }, [refresh]);

  return (
    <GestureHandlerRootView style={styles.container}>
      <SafeAreaProvider>
        {dbName && auxReady ? (
          <SQLiteProvider
            key={dbName}
            databaseName={dbName}
            assetSource={dbName === BUILTIN_DB ? { assetId: require('./assets/items.db') } : undefined}
            onInit={attachAux}
          >
            <ConfigProvider>
              <AppShell onReady={() => setBooted(true)} />
            </ConfigProvider>
          </SQLiteProvider>
        ) : null}
        {booted && (fontsReady || fontError) ? null : <BootOverlay />}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppShell({ onReady }: { onReady: () => void }) {
  const { ready } = useConfig();
  useEffect(() => {
    if (ready) onReady();
  }, [ready, onReady]);
  return (
    <>
      {/* 状态栏不透明：内容永远不会滚到状态栏底下；新版 Android 强制边到边时由各屏的 insets 兜底 */}
      <StatusBar style="light" translucent={false} backgroundColor={colors.bg} />
      <RootNavigator />
      <ToastHost />
    </>
  );
}

/** 启动页：深色底 + 字标 + 转圈，与原生 splash 同色，衔接起来像一次连续启动 */
function BootOverlay() {
  return (
    <View style={styles.boot} pointerEvents="none">
      <Text style={styles.bootTitle}>AEMobile</Text>
      <Text style={styles.bootSub}>GTNH AE 网络监控</Text>
      <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.s }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  boot: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  bootTitle: { color: colors.text, fontSize: 22, fontWeight: '800', letterSpacing: 2 },
  bootSub: { color: colors.textFaint, fontSize: 11, letterSpacing: 1 },
});
