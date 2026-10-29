# 示例照片逐文件来源核查

核查日期：2026-10-29。上游为 [China-Travel-Map](https://github.com/marksui/China-Travel-Map) 的 `data/attraction-images.js`。本地 11 张照片与上游树中对应文件的 Git blob SHA-1 全部一致；这证明文件对应关系，不证明所有分发条件已满足。

| 本地文件 | 上游原始来源页 | 页面核查结果 |
| --- | --- | --- |
| `west-lake.jpg` | [来源](https://zh.wikipedia.org/wiki/%E8%A5%BF%E6%B9%96) | 目前只指向景点百科页；仍需定位实际照片文件页与许可 |
| `wuzhen.jpg` | [来源](https://commons.wikimedia.org/wiki/File:Wuzhen_town_4.JPG) | 已到达具体文件页；需提取该文件的作者与许可模板，不能采用站点页脚许可 |
| `shanghai.jpg` | [来源](https://www.rawpixel.com/image/6040078/photo-image-public-domain-free-landscape) | 有具体素材页；原作者、来源及公共领域依据仍待核实 |
| `palace.jpg` | [来源](https://commons.wikimedia.org/wiki/File:Sunset_of_the_Forbidden_City_2006.JPG) | 已到达具体文件页；需提取该文件的作者与许可模板，不能采用站点页脚许可 |
| `temple.jpg` | [来源](https://www.flickr.com/photos/67525885@N00/54243886365) | 来源页含 CC BY 2.0 许可链接；作者署名与文件对应关系仍需整理 |
| `summer-palace.jpg` | [来源](https://www.flickr.com/photos/67525885@N00/54239317922) | 来源页含 CC BY 2.0 许可链接；作者署名与文件对应关系仍需整理 |
| `great-wall.jpg` | [来源](https://www.flickr.com/photos/50129095@N04/53041030690) | 来源页含 CC BY 2.0 许可链接；作者署名与文件对应关系仍需整理 |
| `jiuzhaigou.jpg` | [来源](https://zh.wikipedia.org/wiki/%E4%B9%9D%E5%AF%A8%E6%B2%9F) | 目前只指向景点百科页；仍需定位实际照片文件页与许可 |
| `huanglong.jpg` | [来源](https://zh.wikipedia.org/wiki/%E9%BB%84%E9%BE%99%E9%A3%8E%E6%99%AF%E5%90%8D%E8%83%9C%E5%8C%BA) | 目前只指向景点百科页；仍需定位实际照片文件页与许可 |
| `emei.jpg` | [来源](https://www.flickr.com/photos/7138083@N04/54534486680) | 来源页含 CC BY 2.0 许可链接；作者署名与文件对应关系仍需整理 |
| `leshan.jpg` | [来源](https://zh.wikipedia.org/wiki/%E4%B9%90%E5%B1%B1%E5%A4%A7%E4%BD%9B) | 目前只指向景点百科页；仍需定位实际照片文件页与许可 |

上游当前文件树未见根 LICENSE 声明；代码、景点数据和图片的使用条件应分别确认。此清单未将任何照片改为项目 MIT 许可，也未自动替换素材。

复核时应记录作者、作品名、具体文件页、许可版本、原始许可链接与修改说明。已有 README 截图中包含示例照片，公开分发时与原图一并核查。
