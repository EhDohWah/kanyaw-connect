import { useTranslation } from 'react-i18next'

import { StateMessage } from '@/components/common/StateMessage'

/** Where `kanyawconnect://calls/:id` lands. One-to-one calls arrive in 8E. */
export default function CallScreen() {
  const { t } = useTranslation()
  return <StateMessage title={t('placeholders.callTitle')} text={t('common.comingSoon')} />
}
