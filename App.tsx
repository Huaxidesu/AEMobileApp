import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import RootNavigator from './src/navigation';
import SetupScreen from './src/screens/SetupScreen';
import { ConfigProvider, useConfig } from './src/config';
import { ChatProvider } from './src/chat';
import { ToastHost } from './src/toast';
import { themedStyles, useTheme, currentPalette, spacing } from './src/theme';
import { ThemeProvider } from './src/theme';
import { GridProvider } from './src/gridprefs';
import { ChatPrefsProvider } from './src/chatprefs';
import { getAuxSignature, resolveActiveDb, subscribeActiveDb } from './src/iconpack';
import { clearDbCaches } from './src/db';
import { attachAux, ensureNameIndex } from './src/dbs';
import { perfLog } from './src/perf';

/** 模块加载时刻（≈ JS 主线程启动），用来量启动各段的耗时 */
const BOOT_T0 = Date.now();

/**
 * 启动页最短停留时间。
 * 正常启动 320ms 就 ready 了，但入场动画要 620ms —— 不兜住的话动画会被切一半，
 * 看起来像「闪了一下」。比这个值快也没关系，多等这 600ms 换一段完整的过场。
 */
const BOOT_MIN_MS = 900;
/** 图标从屏幕正中上移的距离（dp），给下面的转圈和文字腾位置 */
const BOOT_ICON_RISE = 108;
/** 入场动画整个 App 生命周期只跑一次：换图标库时 Overlay 会重挂，别重播 */
let bootIntroPlayed = false;

/** 根组件只负责挂 Provider：主题与布局偏好要在任何界面（含启动页）之前就绪 */
export default function App() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ThemeProvider>
          <GridProvider>
            <ChatPrefsProvider>
              <AppBody />
            </ChatPrefsProvider>
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
  /** 启动页最短停留：到点之前就算 ready 了也继续盖着，让入场动画跑完 */
  const [minSplashDone, setMinSplashDone] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMinSplashDone(true), BOOT_MIN_MS);
    return () => clearTimeout(timer);
  }, []);

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
   * 再加一条：就算上面都就绪了，也至少盖到入场动画放完（见 BOOT_MIN_MS）。
   */
  const fontsPending = !(fontsReady || fontError);
  const showBoot = fontsPending
    || (dbName !== null && !booted && !dbError)
    || (!!dbName && !dbError && !minSplashDone);

  /** 转圈下面那行字：按真实卡在哪一段来报，不是假进度 */
  const bootStatus = fontsPending
    ? '正在加载字体…'
    : dbName === undefined
      ? '正在检查图标库…'
      : !booted
        ? '正在打开物品库…'
        : '正在进入…';

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
      <BootOverlay visible={showBoot} status={bootStatus} />
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
      {/* 聊天订阅常驻：挂在导航之外，切 Tab / 锁屏回来都能收，底栏才有未读角标 */}
      <ChatProvider>
        <RootNavigator />
      </ChatProvider>
      <ToastHost />
    </>
  );
}

/**
 * 启动页：接住系统 splash 里那颗图标，让它往上走一段，下面浮出转圈和文字。
 *
 * 衔接逻辑：Android 12+ 的系统 splash 会把启动图标在正中放大后淡出，
 * 这里第一帧就把同一颗图标画在正中（同底色），视觉上等于「图标没换过，只是继续动」；
 * 上移 108dp 之后下面才是字标 + 转圈，比原来「图标闪一下 → 突然变成纯文字页」连贯。
 */
function BootOverlay({ visible, status }: { visible: boolean; status: string }) {
  const { colors } = useTheme();
  const [mounted, setMounted] = useState(true);
  /** 0 = 图标居中；1 = 图标已上移到位 */
  const intro = useRef(new Animated.Value(bootIntroPlayed ? 1 : 0)).current;
  /** 图标自身的「放大」：系统 splash 那一下之后由这里接手，避免中间断掉 */
  const pop = useRef(new Animated.Value(bootIntroPlayed ? 1 : 0)).current;
  /** 文字单独一条曲线：等图标让开位置再淡入，否则中途会压在图标上 */
  const textIn = useRef(new Animated.Value(bootIntroPlayed ? 1 : 0)).current;
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (bootIntroPlayed) return;
    bootIntroPlayed = true;
    Animated.parallel([
      Animated.timing(pop, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(intro, {
        toValue: 1,
        duration: 520,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(textIn, {
        toValue: 1,
        duration: 340,
        delay: 260,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [intro, pop, textIn]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      fade.setValue(1);
      return;
    }
    Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [visible, fade]);

  if (!mounted) return null;

  const iconY = intro.interpolate({ inputRange: [0, 1], outputRange: [0, -BOOT_ICON_RISE] });
  const iconScale = pop.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] });
  const textY = textIn.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });

  return (
    <Animated.View style={[styles.boot, { opacity: fade }]} pointerEvents="none">
      <Animated.View style={{ transform: [{ translateY: iconY }, { scale: iconScale }] }}>
        <Image source={require('./assets/boot-icon.png')} style={styles.bootIcon} resizeMode="contain" />
      </Animated.View>
      <Animated.View style={[styles.bootText, { opacity: textIn, transform: [{ translateY: textY }] }]}>
        <Text style={styles.bootTitle}>AEMobile</Text>
        <Text style={styles.bootSub}>GTNH AE 网络监控</Text>
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.m }} />
        <Text style={styles.bootStatus}>{status}</Text>
      </Animated.View>
    </Animated.View>
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
  },
  bootIcon: { width: 128, height: 128 },
  // 图标上移到位后底边在 centerY-44，文字从 centerY+10 开始排，留 54dp 空档
  bootText: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    marginTop: 10,
    alignItems: 'center',
    gap: 4,
  },
  bootTitle: { color: colors.text, fontSize: 22, fontWeight: '800', letterSpacing: 2 },
  bootSub: { color: colors.textFaint, fontSize: 11, letterSpacing: 1 },
  bootStatus: { color: colors.textFaint, fontSize: 11, marginTop: 2, letterSpacing: 0.5 },
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
