// 界面布局：每行几列、每页几行、浏览方式（无限下滑 / 翻页）。
// 物品页的网格与分页直接读这里，改完立刻生效。
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { themedStyles, useTheme, spacing, radius } from '../theme';
import { GRID_LIMITS, useGrid } from '../gridprefs';
import { GhostButton, Segmented } from '../components';

/** 一行「- 4 +」的步进器 */
function Stepper({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const { colors } = useTheme();
  const atMin = value <= min;
  const atMax = value >= max;
  return (
    <View style={styles.stepRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.stepLabel}>{label}</Text>
        <Text style={styles.stepHint}>{hint}</Text>
      </View>
      <View style={styles.stepper}>
        <TouchableOpacity
          style={[styles.stepBtn, atMin && styles.stepBtnOff]}
          disabled={atMin}
          onPress={() => onChange(value - 1)}
        >
          <Ionicons name="remove" size={17} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.stepValue}>{value}</Text>
        <TouchableOpacity
          style={[styles.stepBtn, atMax && styles.stepBtnOff]}
          disabled={atMax}
          onPress={() => onChange(value + 1)}
        >
          <Ionicons name="add" size={17} color={colors.text} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function LayoutScreen() {
  const { colors } = useTheme();
  const { prefs, pageSize, setColumns, setRows, setMode, reset } = useGrid();
  const win = useWindowDimensions();
  const paged = prefs.mode === 'page';

  // 预览用和物品页一样的算法：格子等分宽度，保持正方形
  const previewW = win.width - spacing.l * 2 - spacing.m * 2;
  const gap = 6;
  const tileW = Math.max(16, (previewW - gap * (prefs.columns - 1)) / prefs.columns);
  const iconSize = Math.round(Math.max(10, Math.min(22, tileW * 0.52)));
  // 无限下滑也按「一屏的量」预览，免得把 rows 当成硬限制
  const previewRows = paged ? prefs.rows : Math.min(prefs.rows, 5);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ padding: spacing.l, paddingBottom: spacing.xxl, gap: spacing.l }}>
        {/* 预览 */}
        <View>
          <Text style={styles.groupTitle}>预览</Text>
          <View style={styles.previewCard}>
            <View style={styles.previewHead}>
              <Text style={styles.previewTitle}>物品终端</Text>
              <Text style={styles.previewMeta}>
                {paged
                  ? `${prefs.columns} 列 × ${prefs.rows} 行 · 每页 ${pageSize} 个`
                  : `${prefs.columns} 列 · 无限下滑`}
              </Text>
            </View>
            <View style={{ gap }}>
              {Array.from({ length: previewRows }).map((_, r) => (
                <View key={r} style={{ flexDirection: 'row', gap }}>
                  {Array.from({ length: prefs.columns }).map((__, c) => (
                    <View
                      key={c}
                      style={{
                        width: tileW,
                        height: tileW,
                        borderRadius: Math.max(4, radius.m * (tileW / 90)),
                        backgroundColor: colors.surface,
                        borderWidth: 1,
                        borderColor: colors.border,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Ionicons
                        name={c % 4 === 0 ? 'cube' : c % 4 === 1 ? 'water' : c % 4 === 2 ? 'flask' : 'diamond'}
                        size={iconSize}
                        color={colors.textFaint}
                      />
                    </View>
                  ))}
                </View>
              ))}
            </View>
            {paged ? (
              <View style={styles.previewPager}>
                <Ionicons name="chevron-back" size={13} color={colors.textFaint} />
                <Text style={styles.previewPagerText}>
                  第 1 / {Math.max(1, Math.ceil(13316 / pageSize))} 页 · 点页码可跳转
                </Text>
                <Ionicons name="chevron-forward" size={13} color={colors.textFaint} />
              </View>
            ) : (
              <View style={styles.previewPager}>
                <Ionicons name="swap-vertical" size={13} color={colors.textFaint} />
                <Text style={styles.previewPagerText}>一直往下滑 · 右下角有一键到顶 / 到底</Text>
              </View>
            )}
          </View>
          <Text style={styles.footnote}>
            预览按真实物品页的比例渲染；分页模式的页码是按 13316 个物品估算的，实际数量看服务器。
          </Text>
        </View>

        {/* 浏览方式 */}
        <View>
          <Text style={styles.groupTitle}>浏览方式</Text>
          <View style={styles.card}>
            <View style={{ paddingVertical: spacing.m, gap: spacing.m }}>
              <View>
                <Text style={styles.stepLabel}>无限下滑 / 翻页</Text>
                <Text style={styles.stepHint}>
                  无限下滑：全部物品连续排列，右下角一键到顶或到底；
                  翻页：底部出现翻页条，点中间页码可直接跳到指定页。
                </Text>
              </View>
              <Segmented
                options={[
                  { key: 'scroll', label: '无限下滑' },
                  { key: 'page', label: '翻页' },
                ]}
                value={prefs.mode}
                onChange={setMode}
              />
            </View>
          </View>
        </View>

        {/* 步进 */}
        <View>
          <Text style={styles.groupTitle}>网格</Text>
          <View style={styles.card}>
            <Stepper
              label="每行显示"
              hint={`${GRID_LIMITS.columns.min}–${GRID_LIMITS.columns.max} 列，列多了图标会跟着变小`}
              value={prefs.columns}
              min={GRID_LIMITS.columns.min}
              max={GRID_LIMITS.columns.max}
              onChange={setColumns}
            />
            {paged ? (
              <>
                <View style={styles.divider} />
                <Stepper
                  label="每页显示"
                  hint={`${GRID_LIMITS.rows.min}–${GRID_LIMITS.rows.max} 行，超过一页时底部出现翻页条`}
                  value={prefs.rows}
                  min={GRID_LIMITS.rows.min}
                  max={GRID_LIMITS.rows.max}
                  onChange={setRows}
                />
              </>
            ) : (
              <>
                <View style={styles.divider} />
                <View style={styles.stepRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.stepLabel}>每页显示</Text>
                    <Text style={styles.stepHint}>无限下滑模式不限制每页数量，切到翻页后可用</Text>
                  </View>
                  <Text style={styles.disabledValue}>—</Text>
                </View>
              </>
            )}
          </View>
          <Text style={styles.footnote}>
            {paged
              ? `每页 ${pageSize} 个物品（${prefs.columns} × ${prefs.rows}）。行数越多，单页要渲染的图标越多，翻页也越少。`
              : `${prefs.columns} 列，全部物品连续排列；滑到底会显示「已经到底了」。`}
          </Text>
        </View>

        <GhostButton label="恢复默认（无限下滑 · 4 列 × 6 行）" icon="refresh" onPress={reset} />
      </ScrollView>
    </View>
  );
}

const styles = themedStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  groupTitle: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: spacing.s,
    marginLeft: spacing.xs,
  },
  previewCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.m,
    gap: spacing.s,
  },
  previewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previewTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  previewMeta: { color: colors.textFaint, fontSize: 10 },
  previewPager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s,
    marginTop: spacing.xs,
    paddingTop: spacing.s,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  previewPagerText: { color: colors.textFaint, fontSize: 10 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.m,
  },
  divider: { height: 1, backgroundColor: colors.border },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.m, paddingVertical: spacing.m },
  stepLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  stepHint: { color: colors.textFaint, fontSize: 11, marginTop: 2, lineHeight: 15 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.s,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceHigh,
  },
  stepBtnOff: { opacity: 0.35 },
  stepValue: { color: colors.text, fontSize: 16, fontWeight: '800', minWidth: 26, textAlign: 'center' },
  disabledValue: { color: colors.textFaint, fontSize: 16, fontWeight: '800', paddingHorizontal: spacing.m },
  footnote: { color: colors.textFaint, fontSize: 11, lineHeight: 16, marginTop: spacing.s, marginLeft: spacing.xs },
}));
