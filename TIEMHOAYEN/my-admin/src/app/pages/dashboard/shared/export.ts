import { Component, EventEmitter, HostListener, Input, Output, ElementRef, inject } from '@angular/core';
import * as XLSX from 'xlsx';

/** Xuất file dùng chung cho Tổng quan / Bảng phân tích / Danh sách báo cáo. */

export interface ExportSheet {
  name: string;
  /** Dòng tiêu đề phía trên bảng (tên báo cáo, khoảng ngày…) */
  title?: string[];
  rows: Record<string, unknown>[];
}

const safeSheetName = (s: string, used: Set<string>) => {
  let n = s.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Sheet';
  let i = 2;
  while (used.has(n)) n = `${n.slice(0, 28)} ${i++}`;
  used.add(n);
  return n;
};

const colWidths = (rows: Record<string, unknown>[]) => {
  const keys = Object.keys(rows[0] || {});
  return keys.map((k) => ({ wch: Math.min(50, Math.max(k.length + 2, ...rows.slice(0, 300).map((r) => String(r[k] ?? '').length + 2))) }));
};

export const exportExcel = (fileName: string, sheets: ExportSheet[]) => {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  sheets.forEach((s) => {
    const head = (s.title || []).map((t) => [t]);
    if (head.length) head.push([]);
    const ws = XLSX.utils.aoa_to_sheet(head);
    XLSX.utils.sheet_add_json(ws, s.rows.length ? s.rows : [{ 'Không có dữ liệu': '' }], { origin: head.length });
    ws['!cols'] = colWidths(s.rows);
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(s.name, used));
  });
  XLSX.writeFile(wb, `${fileName}.xlsx`);
};

/** CSV một file: nhiều bảng nối tiếp, mỗi bảng có dòng tiêu đề "## Tên bảng". UTF-8 BOM để Excel đọc đúng tiếng Việt. */
export const exportCsv = (fileName: string, sheets: ExportSheet[]) => {
  const parts = sheets.map((s) => {
    const title = [s.name, ...(s.title || [])].map((t) => `"## ${String(t).replace(/"/g, '""')}"`).join('\n');
    const body = s.rows.length ? XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(s.rows)) : 'Không có dữ liệu';
    return `${title}\n${body}`;
  });
  const blob = new Blob(['﻿' + parts.join('\n\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${fileName}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

/** PDF: hộp thoại In của trình duyệt (giữ đúng font tiếng Việt) → chọn "Lưu dưới dạng PDF". */
export const printPdf = (): void => {
  setTimeout(() => window.print(), 60);
};

export type ExportKind = 'excel' | 'csv' | 'pdf';

/** Nút "Xuất file" + menu Excel / CSV / PDF. */
@Component({
  selector: 'app-export-menu',
  standalone: true,
  template: `
    <div class="em">
      <button class="em-btn" type="button" (click)="open = !open" [disabled]="disabled || busy">
        <i class="bi" [class.bi-download]="!busy" [class.bi-hourglass-split]="busy"></i> {{ busy ? 'Đang chuẩn bị…' : label }} <i class="bi bi-chevron-down small"></i>
      </button>
      @if (open) {
        <div class="em-menu">
          <button type="button" (click)="pick('excel')"><i class="bi bi-file-earmark-excel"></i> Excel (.xlsx) <span>{{ excelHint }}</span></button>
          <button type="button" (click)="pick('csv')"><i class="bi bi-filetype-csv"></i> CSV <span>{{ csvHint }}</span></button>
          <button type="button" (click)="pick('pdf')"><i class="bi bi-printer"></i> PDF / In <span>Lưu dưới dạng PDF</span></button>
        </div>
      }
    </div>
  `,
  styles: [`
    .em { position: relative; }
    .em-btn { background: #731919; color: #fff; border: 1px solid #731919; border-radius: 8px; padding: 8px 14px; font: inherit; font-weight: 600; font-size: 14px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
    .em-btn:disabled { opacity: .55; cursor: default; }
    .em-menu { position: absolute; right: 0; top: calc(100% + 6px); z-index: 30; background: #fff; border: 1px solid #ece6e3; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.08); padding: 6px; min-width: 300px; }
    .em-menu button { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; background: none; border: 0; padding: 9px 10px; border-radius: 6px; font: inherit; font-size: 14px; cursor: pointer; color: #2b2321; }
    .em-menu button span { margin-left: auto; font-size: 12px; color: #7a6f6b; }
    .em-menu button:hover { background: #fbf6f3; color: #731919; }
    @media print { :host { display: none; } }
  `],
})
export class ExportMenu {
  private el = inject(ElementRef);
  @Input() label = 'Xuất file';
  @Input() disabled = false;
  @Input() busy = false;
  @Input() excelHint = 'nhiều sheet';
  @Input() csvHint = '1 file';
  @Output() export = new EventEmitter<ExportKind>();
  open = false;

  pick(k: ExportKind): void {
    this.open = false;
    this.export.emit(k);
  }

  @HostListener('document:click', ['$event'])
  outside(e: Event): void {
    if (this.open && !this.el.nativeElement.contains(e.target)) this.open = false;
  }
}
