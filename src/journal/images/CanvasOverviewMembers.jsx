import { useState } from 'react'
import Modal from '../Modal'

const PAGE_SIZE = 50

export default function CanvasOverviewMembers({ members = [], selecting = false, onChoose, onClose }) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(members.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages - 1)
  const action = selecting ? '选择' : '打开'
  return <Modal title="局部内容" onClose={onClose}>
    <div className="j-group-editor">
      <p>{members.length} 项内容，{action}具体内容</p>
      <div style={{ display: 'grid', gap: 8 }}>
        {members.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(member => <button type="button" className="j-button" key={member.id} data-member-id={member.id} aria-label={`${action}：${member.label}`} onClick={() => onChoose(member.id)}>{member.label}</button>)}
      </div>
      <div className="j-group-actions">
        <button type="button" className="j-button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button>
        <span role="status">第 {currentPage + 1} / {pages} 页</span>
        <button type="button" className="j-button" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}>下一页</button>
      </div>
    </div>
  </Modal>
}
