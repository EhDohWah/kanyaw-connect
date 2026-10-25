import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'

import { StateMessage } from '@/components/common/StateMessage'

/** A link to an address the app does not have. */
export default function NotFoundScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  return (
    <StateMessage
      title={t('notFound.title')}
      text={t('notFound.text')}
      action={{ label: t('notFound.home'), onPress: () => router.replace('/') }}
    />
  )
}
