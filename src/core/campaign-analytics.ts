type CampaignMetrics = {
  totalSent: number
  accepted: number
  acceptanceRate: number
  dmsSent: number
  responses: number
  responseRate: number
  byTemplate: Array<{
    variant: string
    sent: number
    accepted: number
    rate: number
  }>
  byChannel: Array<{
    channel: string
    sent: number
    accepted: number
    rate: number
  }>
}

type LogEntry = {
  status?: string
  variant?: string
  logChannel?: string
  profileUrl?: string
  executionId?: string
}

export function computeCampaignMetrics(logEntries: LogEntry[]): CampaignMetrics {
  const sentEntries = logEntries.filter((e) => e.status === 'sent')
  const acceptedEntries = logEntries.filter((e) => e.status === 'accepted')
  const dmEntries = logEntries.filter((e) => e.status === 'followup_dm_sent')
  const responseEntries = logEntries.filter((e) => e.status === 'response')

  const totalSent = sentEntries.length
  const accepted = acceptedEntries.length
  const dmsSent = dmEntries.length
  const responses = responseEntries.length

  const variantMap = new Map<string, { sent: number; accepted: number }>()
  for (const entry of sentEntries) {
    const v = entry.variant || 'unknown'
    const cur = variantMap.get(v) ?? { sent: 0, accepted: 0 }
    cur.sent++
    variantMap.set(v, cur)
  }
  for (const entry of acceptedEntries) {
    const v = entry.variant || 'unknown'
    const cur = variantMap.get(v) ?? { sent: 0, accepted: 0 }
    cur.accepted++
    variantMap.set(v, cur)
  }

  const channelMap = new Map<string, { sent: number; accepted: number }>()
  for (const entry of sentEntries) {
    const ch = entry.logChannel || 'unknown'
    const cur = channelMap.get(ch) ?? { sent: 0, accepted: 0 }
    cur.sent++
    channelMap.set(ch, cur)
  }
  for (const entry of acceptedEntries) {
    const ch = entry.logChannel || 'unknown'
    const cur = channelMap.get(ch) ?? { sent: 0, accepted: 0 }
    cur.accepted++
    channelMap.set(ch, cur)
  }

  return {
    totalSent,
    accepted,
    acceptanceRate: totalSent > 0 ? Math.round((accepted / totalSent) * 100) : 0,
    dmsSent,
    responses,
    responseRate: dmsSent > 0 ? Math.round((responses / dmsSent) * 100) : 0,
    byTemplate: [...variantMap.entries()].map(([variant, data]) => ({
      variant,
      sent: data.sent,
      accepted: data.accepted,
      rate: data.sent > 0 ? Math.round((data.accepted / data.sent) * 100) : 0
    })),
    byChannel: [...channelMap.entries()].map(([channel, data]) => ({
      channel,
      sent: data.sent,
      accepted: data.accepted,
      rate: data.sent > 0 ? Math.round((data.accepted / data.sent) * 100) : 0
    }))
  }
}
