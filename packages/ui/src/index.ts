// T028: packages/ui julkinen pinta. Yksi import-polku:
//   import { AppShell, Button } from "@lifeos/ui";
// Sovellus ei importoi alimoduuleja suoraan. Tyylit:
//   import "@lifeos/ui/styles.css";
// (Vite aliasoi polun T028:ssa; T029 Paketoi tarvittaessa.)
// T041: fontti (Hanken Grotesk variable, latin-ext) + tokenit ladataan
// osana pakettia — sovellus ei importoi niitä erikseen. Järjestys:
// fontti ensin (FOUT kuriin font-display:swapilla), sitten tokenit, sitten
// komponenttityylit (tokenit käytössä alla).
import "@fontsource-variable/hanken-grotesk/index.css";
import "./tokens.css";
import "./styles.css";

export { breakpoints, breakpointForWidth, mobileQuery, desktopQuery } from "./breakpoints.ts";
export type { BreakpointKey } from "./breakpoints.ts";
export { Button, Card } from "./primitives.tsx";
export type { ButtonVariant } from "./primitives.tsx";
// A3: yhteinen natiivi checkbox, jolla on teemavärit ja riittävä kosketusalue.
export { Checkbox } from "./checkbox.tsx";
export type { CheckboxProps } from "./checkbox.tsx";
export { Switch } from "./switch.tsx";
export type { SwitchProps } from "./switch.tsx";
// T051: ydintilat (Empty/Skeleton/Alert/Toast + viewport). EmptyState
// re-exportoituu myös primitivesin kautta (vanhat importit säilyvät).
export { Alert, EmptyState, Skeleton, Toast, ToastViewport } from "./states.tsx";
export type { AlertProps, EmptyStateProps, SkeletonProps, ToastProps } from "./states.tsx";
// T046: Button-perhe (IconButton/FAB) + haptics-hook.
export {
  Fab,
  IconButton,
  isHapticsSupported,
  readVibrateFunction,
  useHaptics,
} from "./buttons.tsx";
// T047: lomakekentät (Input/NumberInput/Select/Combobox + Field-kääre).
export { Combobox, FieldShell, Input, NumberInput, Select, describedIds } from "./fields.tsx";
export type {
  ComboboxProps,
  NumberFieldProps,
  SelectOption,
  SelectProps,
  TextFieldProps,
} from "./fields.tsx";
// T048: päivä/aika + segmentoitu valitsin.
export { DatePicker, TimePicker } from "./datetime.tsx";
export type { DateFieldProps, TimeFieldProps } from "./datetime.tsx";
export { SegmentedControl } from "./segmented.tsx";
export type { SegmentedControlProps, SegmentedOption } from "./segmented.tsx";
// T049: korttiperheet (Toiminta/Edistyminen/Loki/Hiljainen + Status).
export { ActionCard, LogCard, MetricCard, QuietCard, StatusCard } from "./cards.tsx";
export type { LogRow, MetricTone, StatusTone } from "./cards.tsx";
// T189: AchievementCard (saavutusmerkki listassa; §54 yhteiskomponentti).
export { AchievementCard } from "./achievements.tsx";
export type { AchievementCardProps, AchievementState } from "./achievements.tsx";
// T053: chart frame -perusta (ChartFrame + StatChip; ei rendereriä).
export { ChartFrame, StatChip } from "./charts.tsx";
export type {
  ChartFrameProps,
  ChartFrameSeries,
  ChartRangeOption,
  ChartSeriesPoint,
  StatChipProps,
} from "./charts.tsx";
// T054: motion system (presets + reduced-motion-ydin + hook).
export {
  REDUCED_MOTION_QUERY,
  isMotionPreset,
  motionPresetFor,
  motionPresetStates,
  motionPresets,
} from "./motion.ts";
export type { MotionPreset } from "./motion.ts";
export { readSystemReducedMotion, useReducedMotion } from "./motion.tsx";
// T052: progress-komponentit (ProgressBar/ProgressRing/StreakDots/GoalProgress).
// T183: LevelProgress (tason etenemä samalla rakenteella).
export { GoalProgress, LevelProgress, ProgressBar, ProgressRing, StreakDots } from "./progress.tsx";
export type {
  GoalProgressProps,
  LevelProgressProps,
  ProgressBarProps,
  ProgressRingProps,
  StreakDotsProps,
  StreakDayState,
} from "./progress.tsx";
// T050: overlay-perhe (Modal/BottomSheet/Drawer + yhteinen Overlay-ydin).
export { BottomSheet, Drawer, Modal, Overlay } from "./overlay.tsx";
export type { OverlayVariant } from "./overlay.tsx";
// T045: typografiahierarkia (Display/Body/Meta + tabular-numerot) + Icon.
export { Body, Display, HeroNumber, Meta, MetricValue, SectionHeading } from "./typography.tsx";
export { Icon } from "./Icon.tsx";
export type { IconKey } from "./Icon.tsx";
export { iconAssetUrl, iconKeys } from "./icons.ts";
export { AppShell } from "./AppShell.tsx";
export type { ShellRoute } from "./AppShell.tsx";
// T044: shell-navimalli (testattava ilman selainta) + ikonityyppi.
export { activeNavPath, buildShellNav, iconForPath, isKnownShellPath } from "./shellNav.ts";
export type { ShellIconKey, ShellNav, ShellNavItem } from "./shellNav.ts";
export {
  elevationTokens,
  focusTokens,
  motionTokens,
  palette,
  paletteDark,
  radiusTokens,
  semanticDark,
  semanticLight,
  spaceTokens,
  touchTokens,
  typeTokens,
} from "./tokens.ts";
// T042/T043: teemapreferenssin puhdas ydin (parse/resolve/labels).
// Provider + adapteri elävät web-puolella (T025-raja: ei selainta ui:ssa).
export {
  THEME_STORAGE_KEY,
  parseThemePreference,
  resolveTheme,
  themeAttribute,
  themeColorFor,
  themePreferenceLabel,
} from "./theme.ts";
export type { ThemePreference, ResolvedTheme } from "./theme.ts";
