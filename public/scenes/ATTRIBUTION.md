# 西湖场景数据

- 湖岸与岛屿边界：[OpenStreetMap relation 2308774](https://www.openstreetmap.org/relation/2308774)，© OpenStreetMap contributors，ODbL。
- 地形高程：[Mapzen Terrain Tiles / AWS Open Data](https://registry.opendata.aws/terrain-tiles/)。
- 数据范围与来源标记保存在 `westlake.json` 中。湖岸采用实际坐标和墨卡托投影，高程经过垂直比例调整，便于观察。
- 雷峰塔为程序生成的微缩建筑示意，不是实景扫描或精确建筑模型。

场景完全在本地渲染，不请求在线地图瓦片。只有与西湖关联的照片会显示在侧栏；有具体位置的照片通过相同编号与场景标记对应。未补充位置的照片不生成虚构的拍摄点。
