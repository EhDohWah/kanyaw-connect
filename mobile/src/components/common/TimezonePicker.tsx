import { Check, ChevronDown } from 'lucide-react-native'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Pressable, SectionList, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { AppText } from '@/components/common/AppText'
import { Button } from '@/components/common/Button'
import { colors, radius, space, TOUCH_TARGET } from '@/theme/tokens'
import { COMMON_TIMEZONES, allTimezones } from '@/utils/timezones'

export interface TimezonePickerProps {
  label: string
  hint?: string
  error?: string
  value: string
  onChange: (zone: string) => void
}

/** A field that opens the list of time zones: the common ones first, then every zone the phone knows. */
export function TimezonePicker({ label, hint, error, value, onChange }: TimezonePickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const sections = useMemo(() => {
    const common = new Set<string>(COMMON_TIMEZONES)
    const others = allTimezones().filter((zone) => !common.has(zone))
    // The account's zone might be one the phone does not list; keep it choosable.
    if (!common.has(value) && !others.includes(value)) others.unshift(value)
    return [
      { title: t('profile.commonZones'), data: [...COMMON_TIMEZONES] as string[] },
      ...(others.length > 0 ? [{ title: t('profile.allZones'), data: others }] : []),
    ]
  }, [t, value])

  return (
    <View style={styles.wrap}>
      <AppText size="sm" weight={500}>
        {label}
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
        accessibilityHint={error || hint}
        onPress={() => setOpen(true)}
        style={[styles.field, { borderColor: error ? colors.danger : colors.border }]}
      >
        <AppText style={styles.grow}>{value}</AppText>
        <ChevronDown size={20} color={colors.textMuted} />
      </Pressable>
      {error || hint ? (
        <AppText size="sm" color={error ? 'danger' : 'textMuted'}>
          {error || hint}
        </AppText>
      ) : null}

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)} presentationStyle="pageSheet">
        <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
          <View style={styles.sheetHeader}>
            <AppText size="lg" weight={600} accessibilityRole="header" style={styles.grow}>
              {label}
            </AppText>
            <Button label={t('common.close')} variant="ghost" onPress={() => setOpen(false)} />
          </View>
          <SectionList
            sections={sections}
            keyExtractor={(zone, index) => `${zone}-${index}`}
            renderSectionHeader={({ section }) => (
              <AppText size="sm" weight={600} color="textMuted" style={styles.sectionTitle} accessibilityRole="header">
                {section.title}
              </AppText>
            )}
            renderItem={({ item }) => {
              const selected = item === value
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    onChange(item)
                    setOpen(false)
                  }}
                  style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.surface }]}
                >
                  <AppText weight={selected ? 600 : 400} style={styles.grow}>
                    {item}
                  </AppText>
                  {selected ? <Check size={20} color={colors.primary} /> : null}
                </Pressable>
              )
            }}
            initialNumToRender={30}
          />
        </SafeAreaView>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: space[1] },
  field: {
    minHeight: TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space[3],
    gap: space[2],
  },
  grow: { flex: 1 },
  sheet: { flex: 1, backgroundColor: colors.bg },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space[4], paddingVertical: space[2] },
  sectionTitle: { backgroundColor: colors.surface, paddingHorizontal: space[4], paddingVertical: space[2] },
  option: {
    minHeight: TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space[4],
    gap: space[2],
  },
})
