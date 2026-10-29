import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import RootNavigator from './src/navigation';
import SetupScreen from './src/screens/SetupScreen';
import { ConfigProvider, useConfig } from './src/config';
import { ToastHost } from './src/toast';
import { themedStyles, useTheme, currentPalette, spacing } from './src/theme';
import { ThemeProvider } from './src/theme';
import { GridProvider } from './src/gridprefs';
import { getAuxSignature, resolveActiveDb, subscribeActiveDb } from './src/iconpack';
import { clearDbCaches } from './src/db';
import { attachAux, ensureNameIndex } from './src/dbs';
import { perfLog } from './src/perf';

/** 模块加载时刻（≈ JS 主线程启动），用来量启动各段的耗时 */
const BOOT_T0 = Date.now();

/** 根组件只负责挂 Provider：主题与布局偏好要在任何界面（含启动页）之前就绪 */
export default function App() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ThemeProvider>
          <GridProvider>
            <AppBody />
          </GridProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppBody() {
  const { colors } = useTheme();
  // 图标库可能被在线更新替换过：数据库名存 SecureStore，切换后靠 key 重新挂载 Provider
  /** undefined = 还在判断；null = 没有任何物品库（要走首次配置） */
  const [dbName, setDbName] = useState<string | null | undefined>(undefined);
  /** 辅助库（流体/源质）换过也要重挂 Provider，否则 ATTACH 还是旧的 */
  const [auxSig, setAuxSig] = useState('');
  /** 首帧 UI 出来之前一直盖着启动页，避免 SQLite 打开/导入期间露出空白 */
  const [booted, setBooted] = useState(false);
  /** 打开图标库失败：必须显示出来，否则用户看到的是一片黑 */
  const [dbError, setDbError] = useState<string | null>(null);
  /**
   * 图标字体必须显式预加载。
   * @expo/vector-icons 是在**第一次渲染某个图标时**才去加载 ttf 的，
   * 所以底栏会出现「先有文字、几百毫秒后图标才冒出来」的闪烁。
   */
  const [fontsReady, fontError] = useFonts(Ionicons.font);
  /** 辅助库（流体/源质）由 resolveActiveDb 里的内置包落地负责，这里只等它就绪 */
  const [auxReady, setAuxReady] = useState(false);

  const refresh = useCallback(() => {
    const t0 = Date.now();
    resolveActiveDb()
      .then((name) => {
        perfLog('boot.resolveDb', `${name ?? 'none'} · ${Date.now() - t0}ms · 总计 ${Date.now() - BOOT_T0}ms`);
        clearDbCaches();
        setDbError(null);
        setDbName(name);
        setAuxSig(getAuxSignature());
        setAuxReady(true);
      })
      .catch((e) => {
        // 判断失败时退回「没有图标库」，让用户能回到首次配置页重试
        console.warn('[db] resolve failed', e);
        setDbName(null);
      });
  }, []);

  useEffect(() => {
    refresh();
    return subscribeActiveDb(refresh);
  }, [refresh]);

  const openDbFailed = useCallback((e: Error) => {
    console.warn('[db] open failed', e);
    setDbError(e?.message ?? String(e));
  }, []);

  /**
   * 启动页要盖住两段空窗：字体没就绪，以及「已确定库名、但主界面还没挂好」。
   * 后者包括 SQLite 打开 186MB 物品库的那几秒 —— 之前这段是纯黑屏，看着像崩了。
   */
  const showBoot = !(fontsReady || fontError) || (dbName !== null && !booted && !dbError);

  return (
    <View style={styles.container}>
      <Boundary>
          {dbError ? (
            <FailScreen message={dbError} onRetry={refresh} />
          ) : dbName === null ? (
            // 没有图标库：先让用户导入配置包 / 填图标源，下载完再进主界面
            <ConfigProvider>
              <SetupScreen onDone={refresh} />
            </ConfigProvider>
          ) : dbName && auxReady ? (
            <SQLiteProvider
              key={`${dbName}|${auxSig}`}
              databaseName={dbName}
              // attachAux 在「库已打开」之后才跑，所以它的耗时点也就是 SQLite 打开完成点
              onInit={async (db) => {
                const t0 = Date.now();
                await attachAux(db);
                perfLog('boot.dbOpen+attach', `${Date.now() - t0}ms · 总计 ${Date.now() - BOOT_T0}ms`);
              }}
              onError={openDbFailed}
            >
              <ConfigProvider>
                <AppShell dbName={dbName} onReady={() => setBooted(true)} />
              </ConfigProvider>
            </SQLiteProvider>
          ) : null}
      </Boundary>
      {showBoot ? <BootOverlay /> : null}
    </View>
  );
}

function AppShell({ dbName, onReady }: { dbName: string; onReady: () => void }) {
  const { colors } = useTheme();
  const { ready } = useConfig();
  const db = useSQLiteContext();
  useEffect(() => {
    if (ready) {
      perfLog('boot.ready', `总计 ${Date.now() - BOOT_T0}ms`);
      onReady();
    }
  }, [ready, onReady]);

  // 覆盖索引延后建：194MB 库上建一次要 1–2 秒，别和首屏抢数据库
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      const t0 = Date.now();
      ensureNameIndex(db, dbName).then(() => perfLog('db.ensureNameIndex', `${Date.now() - t0}ms`));
    }, 5000);
    return () => clearTimeout(timer);
  }, [ready, db, dbName]);
  return (
    <>
      {/* 状态栏不透明：内容永远不会滚到状态栏底下；新版 Android 强制边到边时由各屏的 insets 兜底 */}
      <StatusBar style={colors.isDark ? 'light' : 'dark'} translucent={false} backgroundColor={colors.bg} />
      <RootNavigator />
      <ToastHost />
    </>
  );
}

/** 启动页：深色底 + 字标 + 转圈，与原生 splash 同色，衔接起来像一次连续启动 */
function BootOverlay() {
  const { colors } = useTheme();
  return (
    <View style={styles.boot} pointerEvents="none">
      <Text style={styles.bootTitle}>AEMobile</Text>
      <Text style={styles.bootSub}>GTNH AE 网络监控</Text>
      <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.s }} />
    </View>
  );
}

/** 库打不开时的兜底页：给出原因和重试，而不是留一块黑屏 */
function FailScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.fail}>
      <Ionicons name="alert-circle-outline" size={44} color={colors.accent} />
      <Text style={styles.failTitle}>图标库打不开</Text>
      <Text style={styles.failBody}>{message}</Text>
      <Pressable style={styles.failBtn} onPress={onRetry}>
        <Text style={styles.failBtnText}>重试</Text>
      </Pressable>
      <Text style={styles.failHint}>一直失败的话，去「设置 → 存储与缓存」清掉在线图标库，会回到首次使用页。</Text>
    </View>
  );
}

/**
 * 渲染期异常的兜底：release 包里 React 出错只会留下一片黑，
 * 这里至少把错误文本显示出来，方便反馈问题。
 */
class Boundary extends React.Component<{ children: React.ReactNode }, { err: Error | null }> {
  state: { err: Error | null } = { err: null };

  static getDerivedStateFromError(err: Error) {
    return { err };
  }

  componentDidCatch(err: Error) {
    console.warn('[ui] render error', err);
  }

  render() {
    if (!this.state.err) return this.props.children;
    const colors = currentPalette();
    return (
      <View style={styles.fail}>
        <Ionicons name="bug-outline" size={44} color={colors.accent} />
        <Text style={styles.failTitle}>界面出错了</Text>
        <Text style={styles.failBody}>{this.state.err.message}</Text>
        <Pressable style={styles.failBtn} onPress={() => this.setState({ err: null })}>
          <Text style={styles.failBtnText}>重试</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = themedStyles((colors) => ({
  root: { flex: 1 },
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
  fail: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.l,
    gap: spacing.m,
  },
  failTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  failBody: { color: colors.textDim, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  failBtn: {
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.s,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  failBtnText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  failHint: { color: colors.textFaint, fontSize: 11, lineHeight: 17, textAlign: 'center' },
}));
