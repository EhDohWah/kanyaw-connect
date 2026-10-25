import { House } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'

import { StateMessage } from '@/components/common/StateMessage'
import { colors } from '@/theme/tokens'

/** Home is the community feed on the web. On the phone it arrives with the real feed (after Phase 8). */
export default function HomeScreen() {
  const { t } = useTranslation()
  return (
    <StateMessage
      icon={<House size={40} color={colors.textMuted} />}
      title={t('app.name')}
      text={`${t('app.tagline')}\n\n${t('common.comingSoon')}`}
    />
  )
}
