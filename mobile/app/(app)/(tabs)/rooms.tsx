import { Video } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'

import { StateMessage } from '@/components/common/StateMessage'
import { colors } from '@/theme/tokens'

/** The meeting lists arrive in 8D. */
export default function MeetingsScreen() {
  const { t } = useTranslation()
  return (
    <StateMessage
      icon={<Video size={40} color={colors.textMuted} />}
      title={t('placeholders.meetingsTitle')}
      text={t('placeholders.meetingsText')}
    />
  )
}
