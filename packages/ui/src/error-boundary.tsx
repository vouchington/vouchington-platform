'use client'

import { Component, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

/**
 * Local replacement for react-error-boundary's `ErrorBoundary`. React has no hook-based error
 * boundary API, so catching render errors still requires a class component with
 * `getDerivedStateFromError`.
 *
 * Supports only a static `fallback` prop. react-error-boundary's `fallbackRender`,
 * `FallbackComponent`, `onError`, `onReset`, and `resetKeys` are not reimplemented here — if a
 * future consumer needs reset-on-key-change or an error callback, add it here deliberately. React
 * itself still reports the caught error to the console via its own error-boundary handling,
 * matching what react-error-boundary did with no `onError` supplied.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  render(): ReactNode {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}
