'use client';

import { Button, Dropdown } from 'antd';
import { DownloadOutlined, FileExcelOutlined, FilePdfOutlined, FileTextOutlined, PrinterOutlined } from '@ant-design/icons';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { useAction } from '@/lib/hooks';
import { exportExcel, exportCsv, toPdfSection, printTable } from '@/lib/exporters';
import { reportPdf } from '@/pdf/generate';
import { useLang } from '@/i18n/LangContext';

/**
 * Export a table as Excel / CSV / PDF / Print.
 * Either pass { columns, rows, totals } for a single table, or `sections` for multi-table reports.
 */
export default function ExportButtons({ title, subtitle, columns, rows, totals, sections, landscape = true, size, getRows, totalsFor, count }) {
  const { t: tr } = useLang();
  const { user, can } = useAuth();
  const { settings } = useAppData();
  const [run, busy] = useAction();
  if (!can('reports.export')) return null;

  // translate column / section headings for the current UI language
  const build = (rs) => (sections || [{ columns, rows: rs, totals: getRows && totalsFor ? totalsFor(rs) : totals }]).map((sec) => ({
    ...sec,
    title: sec.title ? tr(sec.title) : sec.title,
    columns: sec.columns.map((c) => ({ ...c, title: tr(c.title) })),
    totals: sec.totals ? Object.fromEntries(Object.entries(sec.totals).map(([k, v]) => [k, typeof v === 'string' ? tr(v) : v])) : sec.totals,
  }));
  // big lists pass getRows(): EVERY matching record is fetched from the server first (not only the rows on screen)
  const withRows = (fn) => run(async () => fn(build(getRows ? await getRows() : rows)));
  const items = [
    { key: 'xlsx', icon: <FileExcelOutlined />, label: tr('Excel (.xlsx)'), onClick: () => withRows((secs) => exportExcel({ title, subtitle, settings, sections: secs })) },
    { key: 'csv', icon: <FileTextOutlined />, label: tr('CSV'), onClick: () => withRows((secs) => exportCsv({ title, sections: secs })) },
    {
      key: 'pdf', icon: <FilePdfOutlined />, label: tr('PDF'),
      onClick: () => withRows((secs) => reportPdf({ settings, title, filtersText: subtitle, landscape, generatedBy: user?.name, labels: { generated: tr('Generated'), page: tr('Page') }, sections: secs.map((x) => toPdfSection(x)) })),
    },
    { key: 'print', icon: <PrinterOutlined />, label: tr('Print'), onClick: () => withRows((secs) => printTable({ title, subtitle, settings, sections: secs.map((x) => toPdfSection(x)) })) },
  ];
  const hasData = getRows ? (count ?? 1) > 0 : (sections || [{ rows }]).some((x) => x.rows?.length);
  return (
    <Dropdown menu={{ items }} disabled={!hasData}>
      <Button icon={<DownloadOutlined />} loading={busy} size={size}>{tr('Export')}</Button>
    </Dropdown>
  );
}
