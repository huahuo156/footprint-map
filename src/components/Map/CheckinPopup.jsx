import LikeButton from '../LikeButton'
import { timeAgo, getPublicUrl } from '../../lib/utils'

export default function CheckinPopup({ checkin }) {
  const imageUrl = checkin.image_url?.startsWith('http')
    ? checkin.image_url
    : getPublicUrl('checkin-images', checkin.image_url)

  return (
    <div className="w-64">
      <img src={imageUrl} alt={checkin.caption || '打卡照片'} className="w-full h-40 object-cover rounded-t-lg" />
      <div className="p-3">
        <p className="text-sm text-gray-800 mb-2">{checkin.caption || '无描述'}</p>
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{checkin.profiles?.nickname || '匿名用户'}</span>
          <span>{timeAgo(checkin.created_at)}</span>
        </div>
        <div className="mt-2">
          <LikeButton targetId={checkin.id} targetType="checkin" count={checkin.likes_count} />
        </div>
      </div>
    </div>
  )
}
