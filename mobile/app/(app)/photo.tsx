import { useTranslation } from 'react-i18next'

import { StateMessage } from '@/components/common/StateMessage'

/** The full-screen photo viewer: arrives with 8C.3. */
export default function PhotoScreen() {
  const { t } = useTranslation()
  return <StateMessage title={t('chat.viewer.title')} text={t('common.comingSoon')} />
}
