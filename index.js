// Detectar cambios en columna PAGADO y colores amarillos (MEJORADO Y SEGURO)
async function detectarCambiosPagado() {
  try {
    const sheetPrincipal = doc.sheetsByIndex[1];
    if (!sheetPrincipal) {
      console.error('❌ No se encontró Hoja 2');
      return;
    }
    
    const rowsPrincipal = await sheetPrincipal.getRows();
    
    // Verificar colores amarillos en hojas de vendedores
    for (const vendedor of VENDEDORES) {
      try {
        const hojaVendedor = doc.sheetsByTitle[vendedor];
        if (!hojaVendedor) continue;
        
        const rowsVendedor = await hojaVendedor.getRows();
        
        for (const rowVendedor of rowsVendedor) {
          const numero = rowVendedor.get('NUMERO');
          
          if (!numero) continue;
          
          try {
            // Cargar TODAS las celdas de la fila para verificar el color
            await hojaVendedor.loadCells(`A${rowVendedor.rowNumber}:M${rowVendedor.rowNumber}`);
            
            // Verificar si TODAS o la mayoría de celdas son amarillas
            let celdasAmarillas = 0;
            for (let i = 0; i < 13; i++) {
              const cell = hojaVendedor.getCell(rowVendedor.rowNumber - 1, i);
              const bgColor = cell.backgroundColor;
              
              if (bgColor) {
                const esAmarillo = bgColor.red > 0.9 && 
                                  bgColor.green > 0.9 && 
                                  bgColor.blue < 0.3;
                
                if (esAmarillo) celdasAmarillas++;
              }
            }
            
            // Si al menos 10 de 13 celdas son amarillas, consideramos la fila amarilla
            if (celdasAmarillas >= 10) {
              const estadoActualVendedor = rowVendedor.get('ESTADO');
              
              console.log(`🟡 Fila amarilla detectada en ${vendedor}: ${numero} (${celdasAmarillas}/13 celdas)`);
              
              // Actualizar estado en hoja vendedor si no es Completado
              if (estadoActualVendedor !== 'Completado') {
                rowVendedor.set('ESTADO', 'Completado');
                rowVendedor.set('PAGADO', 'PAGADO');
                await rowVendedor.save();
                console.log(`✅ Estado actualizado en ${vendedor}: ${numero} → Completado`);
              }
              
              // Asegurar que el texto sea negro en hoja vendedor
              for (let i = 0; i < 13; i++) {
                const cell = hojaVendedor.getCell(rowVendedor.rowNumber - 1, i);
                cell.textFormat = { foregroundColor: { red: 0, green: 0, blue: 0 } };
              }
              await hojaVendedor.saveUpdatedCells();
              
              // Sincronizar con Hoja 2
              const rowPrincipal = rowsPrincipal.find(r => r.get('NUMERO') === numero);
              if (rowPrincipal) {
                const estadoPrincipal = rowPrincipal.get('ESTADO');
                const pagadoPrincipal = rowPrincipal.get('PAGADO');
                
                // Si Hoja 2 no está en Completado o no es PAGADO, actualizar
                if (estadoPrincipal !== 'Completado' || pagadoPrincipal !== 'PAGADO') {
                  console.log(`🟡 Sincronizando a Hoja 2: ${numero} → Completado + Amarillo`);
                  rowPrincipal.set('ESTADO', 'Completado');
                  rowPrincipal.set('PAGADO', 'PAGADO');
                  await rowPrincipal.save();
                }
                
                // SIEMPRE aplicar el color amarillo en Hoja 2 para asegurar sincronización
                await aplicarColorEstado(sheetPrincipal, rowPrincipal.rowNumber, 'Completado');
                console.log(`✅ Hoja 2 actualizada: ${numero} → Amarillo con texto negro`);
              }
            }
          } catch (cellError) {
            console.error(`❌ Error procesando fila ${rowVendedor.rowNumber} en ${vendedor}:`, cellError.message);
          }
        }
      } catch (vendorError) {
        console.error(`❌ Error procesando vendedor ${vendedor}:`, vendorError.message);
      }
    }
    
  } catch (error) {
    console.error('❌ Error en detectarCambiosPagado:', error.message);
  }
}
