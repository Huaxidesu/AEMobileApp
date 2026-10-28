// 根导航：未配置 → 连接表单；已配置 → 四 Tab 主界面 + 设置子页
import React, { Suspense, useRef } from 'react';
import { Text, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useConfig } from './config';
import { useTheme, Palette } from './theme';
import ItemsScreen from './screens/ItemsScreen';
import ItemDetailScreen from './screens/ItemDetailScreen';
import PlanReviewScreen from './screens/PlanReviewScreen';
import CraftScreen from './screens/CraftScreen';
import SettingsScreen from './screens/SettingsScreen';
import ServerSettingsScreen from './screens/ServerSettingsScreen';
import ServerListScreen from './screens/ServerListScreen';
import IconPackScreen from './screens/IconPackScreen';
import CacheScreen from './screens/CacheScreen';
import AboutScreen from './screens/AboutScreen';
import LayoutScreen from './screens/LayoutScreen';
import ThemeScreen from './screens/ThemeScreen';

/**
 * 监控页懒加载：它依赖 echarts（约 1MB JS）+ react-native-echarts，
 * 静态引入会在启动时就解析一遍。而 MSPT 已移除，这一页目前只是占位，
 * 大多数人根本不会打开，所以推迟到真正切过去时再加载。
 */
const MonitorScreen = React.lazy(() => import('./screens/MonitorScreen'));

function LazyMonitor() {
  const { colors } = useTheme();
  return (
    <Suspense fallback={<View style={{ flex: 1, backgroundColor: colors.bg }} />}>
      <MonitorScreen />
    </Suspense>
  );
}

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

/** 设置子页共用的原生导航头（跟随当前主题） */
const subHeader = (title: string, colors: Palette) => ({
  headerShown: true,
  headerTitle: title,
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.text,
  headerTitleStyle: { color: colors.text, fontSize: 16, fontWeight: '700' as const },
  headerShadowVisible: false,
});

function navThemeFor(colors: Palette) {
  return {
    ...DefaultTheme,
    dark: colors.isDark,
    colors: {
      ...DefaultTheme.colors,
      background: colors.bg,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      primary: colors.accent,
      notification: colors.accent,
    },
  };
}

const TAB_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Items: 'grid',
  Craft: 'construct',
  Monitor: 'pulse',
  Settings: 'settings',
};

function MainTabs() {
  const { colors } = useTheme();
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 62,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabel: ({ color }) => <Text style={{ color, fontSize: 10, fontWeight: '600' }}>{TAB_LABELS[route.name]}</Text>,
        tabBarIcon: ({ color, size }) => <Ionicons name={TAB_ICONS[route.name] ?? 'ellipse'} size={size - 2} color={color} />,
      })}
    >
      <Tabs.Screen name="Items" component={ItemsScreen} />
      <Tabs.Screen name="Craft" component={CraftScreen} />
      <Tabs.Screen name="Monitor" component={LazyMonitor} />
      <Tabs.Screen name="Settings" component={SettingsScreen} />
    </Tabs.Navigator>
  );
}

const TAB_LABELS: Record<string, string> = {
  Items: '物品',
  Craft: '合成',
  Monitor: '监控',
  Settings: '设置',
};

export default function RootNavigator() {
  const { colors } = useTheme();
  const { ready, complete } = useConfig();
  // 一旦进过主界面就锁住：切换到一个还没配好的账号时不能让整棵树塌回首次配置页
  const enteredRef = useRef(false);
  if (complete) enteredRef.current = true;
  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  return (
    <NavigationContainer theme={navThemeFor(colors)}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {enteredRef.current ? (
          <Stack.Screen name="Main" component={MainTabs} />
        ) : (
          // 未配置时直接把连接表单当根页：填完保存后整棵树切到主界面
          <Stack.Screen name="Setup" component={ServerSettingsScreen} />
        )}
        <Stack.Screen name="ItemDetail" component={ItemDetailScreen} options={{ presentation: 'modal', ...subHeader('物品详情', colors) }} />
        <Stack.Screen name="PlanReview" component={PlanReviewScreen} options={subHeader('合成计划', colors)} />
        <Stack.Screen name="ServerSettings" component={ServerSettingsScreen} options={subHeader('服务器与账号', colors)} />
        <Stack.Screen name="ServerList" component={ServerListScreen} options={subHeader('服务器列表', colors)} />
        <Stack.Screen name="IconPack" component={IconPackScreen} options={subHeader('图标库', colors)} />
        <Stack.Screen name="CacheDetail" component={CacheScreen} options={subHeader('存储与缓存', colors)} />
        <Stack.Screen name="Layout" component={LayoutScreen} options={subHeader('界面布局', colors)} />
        <Stack.Screen name="Theme" component={ThemeScreen} options={subHeader('主题', colors)} />
        <Stack.Screen name="About" component={AboutScreen} options={subHeader('关于', colors)} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
