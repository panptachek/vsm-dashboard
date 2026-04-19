import { useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  Upload, FileText, ArrowLeft, Loader2, Sun, Moon, AlertTriangle,
} from 'lucide-react'

export function ReportUpload() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [text, setText] = useState('')
  const [sectionCode, setSectionCode] = useState('')
  const [reportDate, setReportDate] = useState(() => {
    const d = new Date()
    return d.toISOString().slice(0, 10)
  })
  const [shift, setShift] = useState<'day' | 'night'>('day')
  const [isDragging, setIsDragging] = useState(false)

  const { data: sections } = useQuery<{ code: string; name: string }[]>({
    queryKey: ['sections-list'],
    queryFn: () => fetch('/api/sections/list').then(r => r.json()),
  })

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/reports/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          section_code: sectionCode,
          date: reportDate,
          shift,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Upload failed' }))
        throw new Error(err.detail || 'Upload failed')
      }
      return res.json()
    },
    onSuccess: async (data) => {
      // Auto-trigger parse
      try {
        await fetch(`/api/reports/${data.id}/parse`, { method: 'POST' })
      } catch {
        // parse errors handled on review page
      }
      navigate(`/reports/${data.id}/review`)
    },
  })

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && file.name.endsWith('.txt')) {
      const reader = new FileReader()
      reader.onload = (ev) => {
        setText(ev.target?.result as string || '')
      }
      reader.readAsText(file)
    }
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (ev) => {
        setText(ev.target?.result as string || '')
      }
      reader.readAsText(file)
    }
  }, [])

  const canSubmit = text.trim().length > 10 && sectionCode && reportDate

  return (
    <div className="p-6 pb-24 lg:pb-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate('/reports')}
          className="p-2 rounded-lg bg-bg-card border border-border shadow-sm hover:border-accent-red/40
                     text-text-muted hover:text-text-primary transition-all"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-heading font-bold text-text-primary">
            Загрузка отчёта
          </h1>
          <p className="text-xs text-text-muted mt-0.5">
            Вставьте текст отчёта или перетащите .txt файл
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: text area */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="lg:col-span-2"
        >
          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`relative rounded-xl border-2 border-dashed transition-all ${
              isDragging
                ? 'border-accent-red bg-accent-burg/10'
                : 'border-border hover:border-border/80'
            }`}
          >
            {!text && (
              <div
                className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10"
              >
                <Upload className="w-10 h-10 text-text-muted mb-3" />
                <p className="text-text-muted text-sm">
                  Перетащите .txt файл сюда
                </p>
                <p className="text-text-muted text-xs mt-1">
                  или вставьте текст отчёта ниже
                </p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-3 text-xs text-accent-red hover:text-red-700 font-medium
                             pointer-events-auto transition-colors"
                >
                  Выбрать файл
                </button>
              </div>
            )}
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder=""
              rows={20}
              className="w-full bg-transparent text-text-primary text-sm font-mono p-4
                         rounded-xl resize-none focus:outline-none
                         placeholder:text-transparent"
              style={{ minHeight: '400px' }}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
          {text && (
            <div className="flex items-center justify-between mt-2 px-1">
              <span className="text-xs text-text-muted font-mono">
                {text.length.toLocaleString('ru-RU')} символов, {text.split('\n').length} строк
              </span>
              <button
                onClick={() => setText('')}
                className="text-xs text-text-muted hover:text-accent-red transition-colors"
              >
                Очистить
              </button>
            </div>
          )}
        </motion.div>

        {/* Right: controls */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="space-y-4"
        >
          {/* Section */}
          <div className="bg-bg-card rounded-xl border border-border shadow-sm p-4">
            <label className="text-xs text-text-muted mb-2 block font-medium">
              Участок
            </label>
            <select
              value={sectionCode}
              onChange={e => setSectionCode(e.target.value)}
              className="w-full bg-bg-surface border border-border rounded-lg px-3 py-2.5 text-sm
                         text-text-primary focus:outline-none focus:border-accent-red/50"
            >
              <option value="">Выберите участок</option>
              {sections?.map(s => (
                <option key={s.code} value={s.code}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Date */}
          <div className="bg-bg-card rounded-xl border border-border shadow-sm p-4">
            <label className="text-xs text-text-muted mb-2 block font-medium">
              Дата отчёта
            </label>
            <input
              type="date"
              value={reportDate}
              onChange={e => setReportDate(e.target.value)}
              className="w-full bg-bg-surface border border-border rounded-lg px-3 py-2.5 text-sm
                         text-text-primary focus:outline-none focus:border-accent-red/50
                         [color-scheme:light]"
            />
          </div>

          {/* Shift */}
          <div className="bg-bg-card rounded-xl border border-border shadow-sm p-4">
            <label className="text-xs text-text-muted mb-2 block font-medium">
              Смена
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setShift('day')}
                className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg
                           text-sm font-medium transition-all ${
                  shift === 'day'
                    ? 'bg-amber-100 text-amber-700 border border-amber-300'
                    : 'bg-bg-surface text-text-muted border border-border hover:text-text-primary'
                }`}
              >
                <Sun className="w-4 h-4" />
                День
              </button>
              <button
                onClick={() => setShift('night')}
                className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg
                           text-sm font-medium transition-all ${
                  shift === 'night'
                    ? 'bg-indigo-100 text-indigo-700 border border-indigo-300'
                    : 'bg-bg-surface text-text-muted border border-border hover:text-text-primary'
                }`}
              >
                <Moon className="w-4 h-4" />
                Ночь
              </button>
            </div>
          </div>

          {/* Submit */}
          <button
            onClick={() => uploadMutation.mutate()}
            disabled={!canSubmit || uploadMutation.isPending}
            className="w-full bg-accent-red hover:bg-red-700 disabled:bg-accent-burg/50
                       disabled:text-text-muted text-white px-4 py-3 rounded-xl text-sm
                       font-medium transition-all inline-flex items-center justify-center gap-2"
          >
            {uploadMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Загрузка...
              </>
            ) : (
              <>
                <FileText className="w-4 h-4" />
                Загрузить и распознать
              </>
            )}
          </button>

          {uploadMutation.isError && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
              <p className="text-xs text-red-600">
                {uploadMutation.error?.message || 'Ошибка загрузки'}
              </p>
            </motion.div>
          )}
        </motion.div>
      </div>
    </div>
  )
}
