export function addMonths(date: Date | string, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

export interface ProfitScheduleItem {
  index: number
  expectedDate: Date
  expectedAmount: number
  isCollected: boolean
  isHistorical: boolean
  actualAmount: number | null
  transactionDate: Date | null
  transactionId: string | null
}

export function generateProfitSchedule(certificate: any, transactions: any[] = []): ProfitScheduleItem[] {
  const amount = Number(certificate.amount || 0)
  const interest_rate = Number(certificate.interest_rate || 0)
  const duration_months = Number(certificate.duration_months || 0)
  const start_date = certificate.start_date
  const payout_frequency = certificate.payout_frequency
  
  const totalInterest = amount * (interest_rate / 100) * (duration_months / 12)
  
  let stepMonths = 1
  switch (payout_frequency) {
    case 'monthly': stepMonths = 1; break;
    case 'quarterly': stepMonths = 3; break;
    case 'semi_annually': stepMonths = 6; break;
    case 'annually': stepMonths = 12; break;
    case 'at_maturity': stepMonths = duration_months; break;
  }
  
  // Prevent division by zero or infinite loops
  if (stepMonths <= 0 || duration_months <= 0) return []

  const numPayouts = Math.floor(duration_months / stepMonths)
  if (numPayouts <= 0) return []

  const payoutAmount = totalInterest / numPayouts
  
  const schedule: ProfitScheduleItem[] = []
  const systemCreatedAt = new Date(certificate.created_at || Date.now())
  
  for (let i = 1; i <= numPayouts; i++) {
    const payoutDate = addMonths(start_date, i * stepMonths)
    // If payout date is before the certificate was added to the system, it's historical
    const isHistorical = payoutDate.getTime() < systemCreatedAt.getTime()

    schedule.push({
      index: i,
      expectedDate: payoutDate,
      expectedAmount: payoutAmount,
      isCollected: false,
      isHistorical,
      actualAmount: null,
      transactionDate: null,
      transactionId: null
    })
  }
  
  // Match actual transactions
  const sortedTransactions = [...transactions].sort(
    (a, b) => new Date(a.created_at || a.transaction_date).getTime() - new Date(b.created_at || b.transaction_date).getTime()
  )
  
  const activeSchedule = schedule.filter(s => !s.isHistorical)
  
  sortedTransactions.forEach((tx, i) => {
    if (activeSchedule[i]) {
      activeSchedule[i].isCollected = true
      activeSchedule[i].actualAmount = Number(tx.amount)
      activeSchedule[i].transactionDate = new Date(tx.transaction_date)
      activeSchedule[i].transactionId = tx.id
    }
  })
  
  return schedule
}
