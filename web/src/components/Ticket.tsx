import { dateTime, fulfillmentLabel, money, orderNo, timeShort } from '../lib/format'
import type { Order, Settings } from '../lib/types'

/**
 * Ticket au format 80 mm, le rouleau standard des caisses.
 *
 * Volontairement sans couleur ni aplat : une imprimante thermique ne
 * connaît que le noir, et les gris se perdent. Tout est en noir sur blanc,
 * avec une graisse suffisante pour rester lisible après quelques semaines
 * dans une poche.
 */

export type TicketKind = 'receipt' | 'kitchen' | 'delivery'

export function Ticket({
  order,
  settings,
  kind,
  cashierName,
}: {
  order: Order
  settings: Settings
  kind: TicketKind
  cashierName?: string
}) {
  const isKitchen = kind === 'kitchen'
  const isDelivery = kind === 'delivery'

  return (
    <div className="ticket">
      {/* En-tête : le bon de cuisine n'a pas besoin de l'adresse, il reste
          au passe. Le reçu, lui, part avec le client. */}
      {isKitchen ? (
        <div className="t-center">
          <div className="t-huge">{orderNo(order.orderNumber)}</div>
          <div className="t-strong">
            {order.source === 'online'
              ? 'EN LIGNE'
              : order.source === 'counter'
                ? 'COMPTOIR'
                : 'BORNE'}
            {' · '}
            {fulfillmentLabel[order.fulfillmentType].toUpperCase()}
          </div>
          <div className="t-small">{timeShort(order.createdAt)}</div>
        </div>
      ) : (
        <div className="t-center">
          <div className="t-title">{settings.restaurantName}</div>
          {settings.address && <div className="t-small">{settings.address}</div>}
          {settings.phone && <div className="t-small">Tél. {settings.phone}</div>}
          {settings.taxId && <div className="t-small">MF {settings.taxId}</div>}
          <div className="t-rule" />
          <div className="t-strong">
            {isDelivery ? 'BON DE LIVRAISON' : 'REÇU'} {orderNo(order.orderNumber)}
          </div>
          <div className="t-small">{dateTime(order.createdAt)}</div>
        </div>
      )}

      <div className="t-rule" />

      {/* Lignes */}
      <table className="t-table">
        <tbody>
          {order.items?.map((it) => {
            const removed = it.customization?.removed ?? []
            const added = it.customization?.added ?? []
            return (
              <tr key={it.id}>
                <td className="t-qty">{it.quantity}×</td>
                <td>
                  <span className={isKitchen ? 't-strong' : ''}>
                    {it.productNameSnapshot}
                  </span>
                  {removed.map((o) => (
                    <div key={o.id} className={isKitchen ? 't-mod-big' : 't-mod'}>
                      {isKitchen ? '*** ' : ''}SANS {o.label.toUpperCase()}
                    </div>
                  ))}
                  {added.map((o) => (
                    <div key={o.id} className={isKitchen ? 't-mod-big' : 't-mod'}>
                      {isKitchen ? '*** ' : ''}EXTRA {o.label.toUpperCase()}
                      {!isKitchen && o.price > 0 ? ` (+${money(o.price)})` : ''}
                    </div>
                  ))}
                </td>
                {!isKitchen && (
                  <td className="t-price">{money(it.unitPrice * it.quantity)}</td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Totaux : inutiles en cuisine, on ne prépare pas un montant. */}
      {!isKitchen && (
        <>
          <div className="t-rule" />
          <Row label="Sous-total" value={money(order.subtotal)} unit={settings.currency} />
          {order.deliveryFee > 0 && (
            <Row label="Livraison" value={money(order.deliveryFee)} unit={settings.currency} />
          )}
          {order.tipAmount > 0 && (
            <Row label="Pourboire" value={money(order.tipAmount)} unit={settings.currency} />
          )}
          <div className="t-rule" />
          <div className="t-total">
            <span>TOTAL</span>
            <span>
              {money(order.totalAmount)} {settings.currency}
            </span>
          </div>

          {order.paymentMethod && (
            <div className="t-small t-center t-gap">
              Réglé en{' '}
              {order.paymentMethod === 'cash'
                ? 'espèces'
                : order.paymentMethod === 'card'
                  ? 'carte'
                  : 'espèces à la livraison'}
            </div>
          )}
        </>
      )}

      {/* Livraison : l'adresse doit tenir sur le bon du livreur. */}
      {isDelivery && order.deliveryAddress && (
        <>
          <div className="t-rule" />
          <div className="t-strong">LIVRER À</div>
          <div className="t-addr">{order.deliveryAddress}</div>
        </>
      )}

      <div className="t-rule" />

      <div className="t-center t-small">
        {isKitchen ? (
          <div className="t-strong">{fulfillmentLabel[order.fulfillmentType]}</div>
        ) : (
          <>
            {cashierName && <div>Servi par {cashierName}</div>}
            {settings.ticketFooter && <div className="t-gap">{settings.ticketFooter}</div>}
          </>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="t-row">
      <span>{label}</span>
      <span>
        {value} {unit}
      </span>
    </div>
  )
}
