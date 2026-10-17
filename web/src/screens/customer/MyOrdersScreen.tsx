import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Bike, Receipt, Store } from 'lucide-react'
import { orders } from '../../lib/api'
import { useAuth } from '../../lib/store'
import { dateTime, moneyDT, orderNo, statusLabel } from '../../lib/format'
import type { Order } from '../../lib/types'
import { Button, Card, EmptyState, Skeleton } from '../../components/ui'

const LIVE: Order['status'][] = [
  'awaiting_payment',
  'in_kitchen',
  'preparing',
  'ready',
  'awaiting_driver',
  'out_for_delivery',
]

export default function MyOrdersScreen() {
  const user = useAuth((s) => s.user)
  const [list, setList] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    if (!user) return
    orders
      .forCustomer(user.id)
      .then(setList)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [user])

  return (
    <div className="min-h-dvh bg-ink-50">
      <header className="sticky top-0 z-30 border-b border-ink-200 bg-white/92 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-lg items-center gap-3 px-4">
          <Link
            to="/commander"
            aria-label="Retour"
            className="-ml-1 grid size-9 place-items-center rounded-full text-ink-600 hover:bg-ink-100"
          >
            <ArrowLeft size={19} />
          </Link>
          <span className="text-[16px] font-bold text-ink-900">Mes commandes</span>
        </div>
      </header>

      <div className="mx-auto max-w-lg space-y-2.5 px-4 py-5">
        {loading ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="h-[76px]" />)
        ) : list.length === 0 ? (
          <Card>
            <EmptyState
              icon={Receipt}
              title="Aucune commande"
              description="Votre historique apparaîtra ici."
              action={
                <Button onClick={() => navigate('/commander')}>Voir la carte</Button>
              }
            />
          </Card>
        ) : (
          list.map((o) => {
            const live = LIVE.includes(o.status)
            return (
              <Link key={o.id} to={`/commande/${o.id}`} className="block">
                <Card className="flex items-center gap-3.5 p-4 transition-colors hover:border-ink-300">
                  <div
                    className={`grid size-10 shrink-0 place-items-center rounded-full ${
                      live ? 'bg-petrol-50 text-petrol-600' : 'bg-ink-100 text-ink-400'
                    }`}
                  >
                    {o.fulfillmentType === 'delivery' ? (
                      <Bike size={18} strokeWidth={2.1} />
                    ) : (
                      <Store size={18} strokeWidth={2.1} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="num text-[15px] font-bold text-ink-900">
                        {orderNo(o.orderNumber)}
                      </span>
                      <span
                        className={`text-[13px] font-semibold ${
                          live ? 'text-petrol-600' : 'text-ink-500'
                        }`}
                      >
                        {statusLabel[o.status]}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[12.5px] text-ink-500">
                      {dateTime(o.createdAt)}
                    </p>
                  </div>
                  <span className="num shrink-0 text-[15px] font-bold text-ink-900">
                    {moneyDT(o.totalAmount)}
                  </span>
                </Card>
              </Link>
            )
          })
        )}
      </div>
    </div>
  )
}
