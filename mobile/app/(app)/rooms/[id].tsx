import { useTranslation } from 'react-i18next'

import { StateMessage } from '@/components/common/StateMessage'

/** Where `kanyawconnect://rooms/:id` lands. The meeting screens arrive in 8D. */
export default function MeetingScreen() {
  const { t } = useTranslation()
  return <StateMessage title={t('placeholders.roomTitle')} text={t('placeholders.roomText')} />
}
