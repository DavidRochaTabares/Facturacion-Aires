const RULES = `Eres un asistente que extrae datos de documentos de una agencia de viajes colombiana.
Responde SOLO con un objeto JSON válido, sin texto adicional ni markdown.
Reglas:
- No inventes ni deduzcas datos. Si un dato no aparece de forma clara en el documento, usa "" (texto) o null (número).
- Fechas en formato YYYY-MM-DD y horas en HH:MM (24 horas).
- Valores monetarios como número, sin símbolos ni separadores de miles (punto decimal). En "currency" pon el código ISO de la moneda del documento (por ejemplo COP o USD).
- Copia tal cual aparecen los códigos de reserva, números de tiquete, de documento y de factura.
- El documento puede ser un escaneo o una imagen: léelo visualmente.`

export const PROMPTS: Record<'flight' | 'hotel' | 'loan' | 'food', string> = {
  flight: `${RULES}

El documento es una emisión de tiquete aéreo. Devuelve exactamente este objeto:
{
  "airline": "aerolínea",
  "provider": "agencia o proveedor que emite el tiquete, si aparece",
  "booking_code": "código de reserva / localizador (PNR)",
  "ticket_number": "número de tiquete",
  "route": "ruta con códigos IATA separados por guion, por ejemplo BOG-MDE-BOG, solo si se puede determinar",
  "total_amount": número con el valor total de TODA la reserva (todos los pasajeros juntos) incluyendo impuestos y tasas,
  "currency": "moneda del valor total",
  "segments": [ { "flight_number": "", "origin": "código IATA o ciudad", "destination": "código IATA o ciudad", "departure_date": "", "departure_time": "", "arrival_time": "", "cabin": "clase o cabina" } ],
  "passengers": [ { "names": "nombres", "surnames": "apellidos", "document_type": "CC, CE, TI, PA o NIT", "document_number": "", "birth_date": "", "email": "", "phone": "", "frequent_flyer": "", "ticket_number": "tiquete de este pasajero", "total_amount": número con el valor del tiquete de ESTE pasajero, solo si el documento lo muestra por pasajero } ]
}
Un objeto por cada tramo (en orden) y uno por cada pasajero. En los tiquetes el nombre suele venir como APELLIDO/NOMBRE: sepáralo correctamente en apellidos y nombres.`,

  hotel: `${RULES}

El documento es un voucher o confirmación de hotel. Devuelve exactamente este objeto:
{
  "reservation_number": "número de reserva / confirmación",
  "accommodation_code": "código de alojamiento si existe",
  "hotel": "nombre del hotel",
  "city": "ciudad o destino",
  "address": "", "phone": "", "email": "",
  "check_in": "", "check_in_time": "", "check_out": "", "check_out_time": "",
  "nights": número de noches,
  "holder": "titular de la reserva",
  "guests": número de huéspedes,
  "room_type": "tipo de habitación",
  "board": "régimen o plan de alimentación",
  "special_requests": "solicitudes especiales",
  "provider": "agencia o proveedor que emite el voucher, si aparece",
  "total_amount": número con el valor total de la reserva, solo si aparece,
  "currency": "moneda del valor total"
}`,

  loan: `${RULES}

El documento es un comprobante, cotización, factura o captura de pantalla relacionada con un préstamo / compra solicitada por un cliente. Devuelve exactamente este objeto, incluyendo solo lo que realmente aparezca:
{
  "date": "fecha del documento",
  "provider": "proveedor o vendedor",
  "amount": número con el valor total,
  "currency": "moneda",
  "invoice_number": "número de factura",
  "invoice_date": "fecha de la factura",
  "request": "descripción breve de lo solicitado o comprado",
  "cot": "número de cotización",
  "oc": "número de orden de compra",
  "iva": número con el valor del IVA,
  "charged_quoted_value": número con el valor cotizado o cobrado, si es distinto al valor total,
  "requested_by": "persona que solicitó",
  "sent": "fecha de envío, solo si aparece",
  "received": "fecha de recibido, solo si aparece",
  "paid": "fecha de pago, solo si aparece"
}`,

  food: `${RULES}

El documento es una factura, recibo, cuenta de cobro, cotización, pedido o captura relacionada con alimentación (comida, refrigerios, almuerzos, catering, domicilios). Devuelve exactamente este objeto, incluyendo solo lo que realmente aparezca:
{
  "date": "fecha del documento o de la solicitud",
  "provider": "restaurante, proveedor o establecimiento",
  "requested_by": "persona que solicitó el pedido, solo si aparece",
  "requested_item": "descripción breve de lo solicitado (productos, menú o evento), solo si aparece",
  "supplies_value": número con el valor de los productos o insumos (sin domicilio ni transporte). Si el documento solo muestra un único total, ponlo aquí,
  "transport_value": número con el valor del domicilio o transporte, solo si aparece como cargo separado,
  "currency": "moneda"
}`,
}
