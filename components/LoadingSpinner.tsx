export function LoadingSpinner({ text = '載入中...' }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <div className="w-10 h-10 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin" />
      <p className="text-gray-500 text-sm">{text}</p>
    </div>
  )
}

export function InlineSpinner() {
  return (
    <span className="inline-block w-4 h-4 border-2 border-gray-300 border-t-orange-500 rounded-full animate-spin" />
  )
}
