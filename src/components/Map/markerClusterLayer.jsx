import { createLayerComponent, extendContext, createElementObject } from '@react-leaflet/core'
import L from 'leaflet'
import 'leaflet.markercluster'

// 用 react-leaflet 的 createLayerComponent 包装 markercluster，使 `<MarkerClusterGroup>`
// 在 JSX 中可用于 react-leaflet v5。低缩放级别聚合为计数圆点，放大后拆分为单个图钉，
// 由 leaflet.markercluster 插件原生处理。
//
// 关键：必须用 extendContext 把 layerContainer 指向聚合组，子 <Marker> 才会被加入该组
// 而非直接加入地图，这样聚合逻辑才能生效。
const createMarkerClusterGroup = (props, context) => {
  const clusterGroup = new L.MarkerClusterGroup({
    // 关闭聚合圆圈的覆盖范围提示，避免 hover 时出现大半圆干扰
    showCoverageOnHover: false,
    // 点击聚合圆放大到其覆盖范围（可被 clusterclick 自定义处理取代）
    zoomToBoundsOnClick: true,
    // 聚合半径（像素）
    maxClusterRadius: 46,
    // 放大后动画拆分
    spiderfyDistanceMultiplier: 1.5,
    ...props,
  })
  return createElementObject(clusterGroup, extendContext(context, { layerContainer: clusterGroup }))
}

const updateMarkerClusterGroup = (instance, props, prevProps) => {
  if (props.maxClusterRadius !== prevProps.maxClusterRadius) {
    instance.options.maxClusterRadius = props.maxClusterRadius
  }
  if (props.disableClusteringAtZoom !== prevProps.disableClusteringAtZoom) {
    instance.options.disableClusteringAtZoom = props.disableClusteringAtZoom
  }
  if (props.iconCreateFunction !== prevProps.iconCreateFunction) {
    instance.options.iconCreateFunction = props.iconCreateFunction
  }
  if (props.showCoverageOnHover !== prevProps.showCoverageOnHover) {
    instance.options.showCoverageOnHover = props.showCoverageOnHover
  }
  if (props.zoomToBoundsOnClick !== prevProps.zoomToBoundsOnClick) {
    instance.options.zoomToBoundsOnClick = props.zoomToBoundsOnClick
  }
}

export const MarkerClusterGroup = createLayerComponent(
  createMarkerClusterGroup,
  updateMarkerClusterGroup,
)

export default MarkerClusterGroup
