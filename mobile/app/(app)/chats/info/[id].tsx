import { useTranslation } from 'react-i18next'

import { StateMessage } from '@/components/common/StateMessage'

/** Group info (members, roles, leave): arrives with 8C.5. */
export default function GroupInfoScreen() {
  const { t } = useTranslation()
  return <StateMessage title={t('chat.conversation.info')} text={t('common.comingSoon')} />
}
