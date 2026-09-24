# Dulce Gestión

MVP web responsive para calcular costos, registrar compras, crear recetas y guardar ventas de una pastelería por encargo.

## Ejecutar localmente

Requiere Node.js 20 o posterior.

```bash
npm run serve
```

Abrir `http://localhost:4173`. Las pruebas se ejecutan con `npm test`.

## Publicación en GitHub Pages

La aplicación no necesita compilación: se puede publicar la raíz del repositorio desde **Settings → Pages → Deploy from a branch**. La interfaz es estática; los datos de la cuenta se guardan en Supabase y pueden exportarse como JSON. En GitHub Free, Pages requiere un repositorio público: no subir secretos, archivos `.env` ni respaldos. `cloud-config.js` contiene únicamente la clave pública prevista para el navegador; la protección de los datos depende de la autenticación y las políticas RLS de Supabase.

## Alcance de esta primera versión

- Insumos con unidades base en gramos, mililitros o unidades.
- Compras y costo promedio ponderado.
- Ajustes manuales de stock con motivo e historial; aportes de insumos del hogar al registrar producciones sin stock suficiente.
- Productos, recetas, rendimiento y precio de venta.
- Edición segura de insumos, productos y recetas.
- Registro de producciones por tanda con validación y descuento de materias primas.
- Gastos opcionales: envases, mano de obra, gas, electricidad, reparto y otros.
- Ventas con una fotografía del costo al momento de registrarlas.
- Pedidos con cliente, teléfono opcional, fecha de entrega, seña, saldo, notas y estado.
- Fichero de clientes reutilizable y agenda de entregas agrupada por fecha.
- Anulación auditable de producciones con devolución exacta de insumos.
- Respaldos versionados, restauración validada y compatibilidad con exportaciones anteriores.
- Integración opcional con Supabase para login, sincronización y control del estado comercial.
- Conversión automática y única de un pedido entregado en una venta.
- Informe mensual y exportación de respaldo.
- PWA instalable. La cuenta y la sincronización requieren conexión a Internet.

## Conexión con Supabase

GitHub Pages no tiene autenticación ni base de datos. Esta app usa el proyecto Supabase `esjxcfdgseiayalrwhhg`; el esquema y la primera cuenta ya están configurados. La conexión está activada para la prueba de inicio de sesión. Los datos que se cargaron previamente en el navegador eran pruebas y **no se suben automáticamente**. El respaldo descargado se conserva por separado.
