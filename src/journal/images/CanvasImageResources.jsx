import { useEffect, useMemo, useRef, useState } from 'react'
import JourneyCanvas from '../JourneyCanvas'
import { ImageResourceProvider } from './ImageResourceProvider.jsx'
import { chooseImageResourceProfile } from './imageResourceProfiles.js'

export default function CanvasImageResources(props) {
  const residency = props.imageResidency ?? import.meta.env.VITE_CANVAS_IMAGE_RESIDENCY === 'true'
  const cache = residency && (props.imageCache ?? import.meta.env.VITE_CANVAS_IMAGE_CACHE === 'true')
  const readProfile = () => chooseImageResourceProfile({
    width: typeof window === 'undefined' ? 1200 : window.innerWidth,
    coarsePointer: typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches,
  })
  const [profile, setProfile] = useState(() => props.imageProfile ?? readProfile())
  const pointers = useRef(new Set())
  const requestedProfile = useRef(profile)
  const applyPending = () => {
    if (!pointers.current.size) setProfile(requestedProfile.current)
  }
  const endPointer = event => {
    pointers.current.delete(event.pointerId)
    applyPending()
  }
  useEffect(() => {
    const query = window.matchMedia?.('(pointer: coarse)')
    const update = () => {
      requestedProfile.current = props.imageProfile ?? chooseImageResourceProfile({ width: window.innerWidth, coarsePointer: !!query?.matches })
      if (!pointers.current.size) setProfile(requestedProfile.current)
    }
    const end = event => {
      pointers.current.delete(event.pointerId)
      if (!pointers.current.size) setProfile(requestedProfile.current)
    }
    const blur = () => {
      pointers.current.clear()
      setProfile(requestedProfile.current)
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    window.addEventListener('blur', blur)
    query?.addEventListener?.('change', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      window.removeEventListener('blur', blur)
      query?.removeEventListener?.('change', update)
    }
  }, [props.imageProfile])
  const mediaSources = useMemo(() => [
    ...(props.data?.entries || []).flatMap(entry => (entry.photos || []).map(photo => photo.url)),
    ...(props.data?.notebooks || []).map(book => book.cover_url).filter(Boolean),
  ], [props.data?.entries, props.data?.notebooks])
  // The stable capture boundary includes blank canvas, groups, and notebooks.
  // Both budgets change in the same commit; the provider's token masks old
  // cache leases immediately while JourneyCanvas computes the smaller plan.
  return <div style={{ display: 'contents' }} onPointerDownCapture={event => pointers.current.add(event.pointerId)} onPointerUpCapture={endPointer} onPointerCancelCapture={endPointer} onLostPointerCaptureCapture={endPointer}>
    <ImageResourceProvider enabled={cache && !props.demo && !!props.userId} ownerId={props.userId} mediaEpoch={props.mediaEpoch} profile={profile} mediaSources={mediaSources}>
    <JourneyCanvas {...props} imageResidency={residency} imageCache={cache} imageProfile={profile} />
    </ImageResourceProvider>
  </div>
}
