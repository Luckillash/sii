// Generado desde el proyecto de Supabase (rbrntkztzijaxsnpgpqn). No editar a mano:
// regenerar con `pnpm db:tipos` o el MCP generate_typescript_types tras cada migración.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      api_keys: {
        Row: {
          alcances: string[]
          ambiente: Database["public"]["Enums"]["ambiente_sii"]
          clave_hash: string
          creado_en: string
          creado_por: string | null
          empresa_id: string | null
          expira_en: string | null
          id: string
          nombre: string
          organizacion_id: string
          prefijo: string
          revocada_en: string | null
          ultimo_uso_en: string | null
        }
        Insert: {
          alcances?: string[]
          ambiente?: Database["public"]["Enums"]["ambiente_sii"]
          clave_hash: string
          creado_en?: string
          creado_por?: string | null
          empresa_id?: string | null
          expira_en?: string | null
          id?: string
          nombre: string
          organizacion_id: string
          prefijo: string
          revocada_en?: string | null
          ultimo_uso_en?: string | null
        }
        Update: {
          alcances?: string[]
          ambiente?: Database["public"]["Enums"]["ambiente_sii"]
          clave_hash?: string
          creado_en?: string
          creado_por?: string | null
          empresa_id?: string | null
          expira_en?: string | null
          id?: string
          nombre?: string
          organizacion_id?: string
          prefijo?: string
          revocada_en?: string | null
          ultimo_uso_en?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      bloqueos_sii: {
        Row: {
          ambiente: Database["public"]["Enums"]["ambiente_sii"]
          certificado_id: string
          titular: string
          tomado_en: string
          vence_en: string
        }
        Insert: {
          ambiente: Database["public"]["Enums"]["ambiente_sii"]
          certificado_id: string
          titular: string
          tomado_en?: string
          vence_en: string
        }
        Update: {
          ambiente?: Database["public"]["Enums"]["ambiente_sii"]
          certificado_id?: string
          titular?: string
          tomado_en?: string
          vence_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "bloqueos_sii_certificado_id_fkey"
            columns: ["certificado_id"]
            isOneToOne: false
            referencedRelation: "certificados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bloqueos_sii_certificado_id_fkey"
            columns: ["certificado_id"]
            isOneToOne: false
            referencedRelation: "v_certificados_estado"
            referencedColumns: ["id"]
          },
        ]
      }
      cafs: {
        Row: {
          actualizado_en: string
          ambiente: Database["public"]["Enums"]["ambiente_sii"]
          caf_secret_id: string
          creado_en: string
          empresa_id: string
          estado: Database["public"]["Enums"]["estado_caf"]
          fecha_autorizacion: string
          folio_desde: number
          folio_hasta: number
          id: string
          idk: number
          organizacion_id: string
          razon_social: string | null
          rut_emisor: string
          siguiente_folio: number
          solicitud_id: string | null
          tipo_dte: number
        }
        Insert: {
          actualizado_en?: string
          ambiente: Database["public"]["Enums"]["ambiente_sii"]
          caf_secret_id: string
          creado_en?: string
          empresa_id: string
          estado?: Database["public"]["Enums"]["estado_caf"]
          fecha_autorizacion: string
          folio_desde: number
          folio_hasta: number
          id?: string
          idk: number
          organizacion_id: string
          razon_social?: string | null
          rut_emisor: string
          siguiente_folio: number
          solicitud_id?: string | null
          tipo_dte: number
        }
        Update: {
          actualizado_en?: string
          ambiente?: Database["public"]["Enums"]["ambiente_sii"]
          caf_secret_id?: string
          creado_en?: string
          empresa_id?: string
          estado?: Database["public"]["Enums"]["estado_caf"]
          fecha_autorizacion?: string
          folio_desde?: number
          folio_hasta?: number
          id?: string
          idk?: number
          organizacion_id?: string
          razon_social?: string | null
          rut_emisor?: string
          siguiente_folio?: number
          solicitud_id?: string | null
          tipo_dte?: number
        }
        Relationships: [
          {
            foreignKeyName: "cafs_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cafs_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cafs_solicitud_fk"
            columns: ["solicitud_id"]
            isOneToOne: false
            referencedRelation: "solicitudes_folios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cafs_tipo_dte_fkey"
            columns: ["tipo_dte"]
            isOneToOne: false
            referencedRelation: "tipos_dte"
            referencedColumns: ["codigo"]
          },
        ]
      }
      certificados: {
        Row: {
          actualizado_en: string
          clave_secret_id: string
          cn: string | null
          creado_en: string
          emisor_ca: string | null
          huella_sha256: string
          id: string
          nombre_titular: string | null
          organizacion_id: string
          pfx_legacy: boolean
          pfx_secret_id: string
          revocado_en: string | null
          rut_titular: string
          subido_por: string | null
          vigente_desde: string | null
          vigente_hasta: string | null
        }
        Insert: {
          actualizado_en?: string
          clave_secret_id: string
          cn?: string | null
          creado_en?: string
          emisor_ca?: string | null
          huella_sha256: string
          id?: string
          nombre_titular?: string | null
          organizacion_id: string
          pfx_legacy?: boolean
          pfx_secret_id: string
          revocado_en?: string | null
          rut_titular: string
          subido_por?: string | null
          vigente_desde?: string | null
          vigente_hasta?: string | null
        }
        Update: {
          actualizado_en?: string
          clave_secret_id?: string
          cn?: string | null
          creado_en?: string
          emisor_ca?: string | null
          huella_sha256?: string
          id?: string
          nombre_titular?: string | null
          organizacion_id?: string
          pfx_legacy?: boolean
          pfx_secret_id?: string
          revocado_en?: string | null
          rut_titular?: string
          subido_por?: string | null
          vigente_desde?: string | null
          vigente_hasta?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "certificados_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      consultas_envio: {
        Row: {
          aceptados: number | null
          consultado_en: string
          envio_id: string
          error: string | null
          estado_sii: string | null
          glosa_sii: string | null
          id: number
          informados: number | null
          organizacion_id: string
          rechazados: number | null
          reparos: number | null
          respuesta: Json | null
        }
        Insert: {
          aceptados?: number | null
          consultado_en?: string
          envio_id: string
          error?: string | null
          estado_sii?: string | null
          glosa_sii?: string | null
          id?: never
          informados?: number | null
          organizacion_id: string
          rechazados?: number | null
          reparos?: number | null
          respuesta?: Json | null
        }
        Update: {
          aceptados?: number | null
          consultado_en?: string
          envio_id?: string
          error?: string | null
          estado_sii?: string | null
          glosa_sii?: string | null
          id?: never
          informados?: number | null
          organizacion_id?: string
          rechazados?: number | null
          reparos?: number | null
          respuesta?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "consultas_envio_envio_id_fkey"
            columns: ["envio_id"]
            isOneToOne: false
            referencedRelation: "envios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultas_envio_envio_id_fkey"
            columns: ["envio_id"]
            isOneToOne: false
            referencedRelation: "v_envios_por_consultar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultas_envio_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      documento_detalles: {
        Row: {
          cantidad: number
          descuento_monto: number
          documento_id: string
          exento: boolean
          id: string
          monto_item: number
          nombre: string
          nro_linea: number
          organizacion_id: string
          precio: number
          producto_id: string | null
          unidad: string | null
        }
        Insert: {
          cantidad: number
          descuento_monto?: number
          documento_id: string
          exento?: boolean
          id?: string
          monto_item: number
          nombre: string
          nro_linea: number
          organizacion_id: string
          precio: number
          producto_id?: string | null
          unidad?: string | null
        }
        Update: {
          cantidad?: number
          descuento_monto?: number
          documento_id?: string
          exento?: boolean
          id?: string
          monto_item?: number
          nombre?: string
          nro_linea?: number
          organizacion_id?: string
          precio?: number
          producto_id?: string | null
          unidad?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documento_detalles_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "documentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documento_detalles_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documento_detalles_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
        ]
      }
      documentos: {
        Row: {
          actualizado_en: string
          ambiente: Database["public"]["Enums"]["ambiente_sii"]
          caf_id: string | null
          caso_set: number | null
          clave_idempotencia: string | null
          creado_en: string
          creado_por: string | null
          descuento_aplicado: number
          descuento_glosa: string | null
          descuento_tipo: Database["public"]["Enums"]["tipo_descuento"] | null
          descuento_valor: number | null
          empresa_id: string
          envio_id: string | null
          estado: Database["public"]["Enums"]["estado_documento"]
          fecha_emision: string
          firmado_en: string | null
          folio: number | null
          id: string
          ind_servicio: number
          iva: number
          metadata: Json
          mnt_exe: number
          mnt_neto: number
          mnt_total: number
          organizacion_id: string
          origen: Database["public"]["Enums"]["origen_documento"]
          receptor_id: string | null
          receptor_razon_social: string | null
          receptor_rut: string
          referencia_codigo: string | null
          referencia_razon: string | null
          tasa_iva: number
          ted_xml: string | null
          timbrado_en: string | null
          tipo_dte: number
          xml_path: string | null
        }
        Insert: {
          actualizado_en?: string
          ambiente: Database["public"]["Enums"]["ambiente_sii"]
          caf_id?: string | null
          caso_set?: number | null
          clave_idempotencia?: string | null
          creado_en?: string
          creado_por?: string | null
          descuento_aplicado?: number
          descuento_glosa?: string | null
          descuento_tipo?: Database["public"]["Enums"]["tipo_descuento"] | null
          descuento_valor?: number | null
          empresa_id: string
          envio_id?: string | null
          estado?: Database["public"]["Enums"]["estado_documento"]
          fecha_emision?: string
          firmado_en?: string | null
          folio?: number | null
          id?: string
          ind_servicio?: number
          iva?: number
          metadata?: Json
          mnt_exe?: number
          mnt_neto?: number
          mnt_total?: number
          organizacion_id: string
          origen?: Database["public"]["Enums"]["origen_documento"]
          receptor_id?: string | null
          receptor_razon_social?: string | null
          receptor_rut?: string
          referencia_codigo?: string | null
          referencia_razon?: string | null
          tasa_iva?: number
          ted_xml?: string | null
          timbrado_en?: string | null
          tipo_dte?: number
          xml_path?: string | null
        }
        Update: {
          actualizado_en?: string
          ambiente?: Database["public"]["Enums"]["ambiente_sii"]
          caf_id?: string | null
          caso_set?: number | null
          clave_idempotencia?: string | null
          creado_en?: string
          creado_por?: string | null
          descuento_aplicado?: number
          descuento_glosa?: string | null
          descuento_tipo?: Database["public"]["Enums"]["tipo_descuento"] | null
          descuento_valor?: number | null
          empresa_id?: string
          envio_id?: string | null
          estado?: Database["public"]["Enums"]["estado_documento"]
          fecha_emision?: string
          firmado_en?: string | null
          folio?: number | null
          id?: string
          ind_servicio?: number
          iva?: number
          metadata?: Json
          mnt_exe?: number
          mnt_neto?: number
          mnt_total?: number
          organizacion_id?: string
          origen?: Database["public"]["Enums"]["origen_documento"]
          receptor_id?: string | null
          receptor_razon_social?: string | null
          receptor_rut?: string
          referencia_codigo?: string | null
          referencia_razon?: string | null
          tasa_iva?: number
          ted_xml?: string | null
          timbrado_en?: string | null
          tipo_dte?: number
          xml_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documentos_empresa_id_caf_id_fkey"
            columns: ["empresa_id", "caf_id"]
            isOneToOne: false
            referencedRelation: "cafs"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "documentos_empresa_id_envio_id_fkey"
            columns: ["empresa_id", "envio_id"]
            isOneToOne: false
            referencedRelation: "envios"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "documentos_empresa_id_envio_id_fkey"
            columns: ["empresa_id", "envio_id"]
            isOneToOne: false
            referencedRelation: "v_envios_por_consultar"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "documentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_receptor_id_fkey"
            columns: ["receptor_id"]
            isOneToOne: false
            referencedRelation: "receptores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_tipo_dte_fkey"
            columns: ["tipo_dte"]
            isOneToOne: false
            referencedRelation: "tipos_dte"
            referencedColumns: ["codigo"]
          },
        ]
      }
      empresa_certificados: {
        Row: {
          certificado_id: string
          creado_en: string
          empresa_id: string
          es_representante_electronico: boolean
          organizacion_id: string
          predeterminado: boolean
        }
        Insert: {
          certificado_id: string
          creado_en?: string
          empresa_id: string
          es_representante_electronico?: boolean
          organizacion_id: string
          predeterminado?: boolean
        }
        Update: {
          certificado_id?: string
          creado_en?: string
          empresa_id?: string
          es_representante_electronico?: boolean
          organizacion_id?: string
          predeterminado?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "empresa_certificados_certificado_id_fkey"
            columns: ["certificado_id"]
            isOneToOne: false
            referencedRelation: "certificados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_certificados_certificado_id_fkey"
            columns: ["certificado_id"]
            isOneToOne: false
            referencedRelation: "v_certificados_estado"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_certificados_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_certificados_organizacion_id_certificado_id_fkey"
            columns: ["organizacion_id", "certificado_id"]
            isOneToOne: false
            referencedRelation: "certificados"
            referencedColumns: ["organizacion_id", "id"]
          },
          {
            foreignKeyName: "empresa_certificados_organizacion_id_certificado_id_fkey"
            columns: ["organizacion_id", "certificado_id"]
            isOneToOne: false
            referencedRelation: "v_certificados_estado"
            referencedColumns: ["organizacion_id", "id"]
          },
          {
            foreignKeyName: "empresa_certificados_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      empresas: {
        Row: {
          activa: boolean
          actualizado_en: string
          autorizada_en: string | null
          autorizada_produccion: boolean
          comuna: string
          correo_intercambio: string | null
          creado_en: string
          direccion: string
          giro: string
          id: string
          organizacion_id: string
          razon_social: string
          rut: string
        }
        Insert: {
          activa?: boolean
          actualizado_en?: string
          autorizada_en?: string | null
          autorizada_produccion?: boolean
          comuna: string
          correo_intercambio?: string | null
          creado_en?: string
          direccion: string
          giro: string
          id?: string
          organizacion_id: string
          razon_social: string
          rut: string
        }
        Update: {
          activa?: boolean
          actualizado_en?: string
          autorizada_en?: string | null
          autorizada_produccion?: boolean
          comuna?: string
          correo_intercambio?: string | null
          creado_en?: string
          direccion?: string
          giro?: string
          id?: string
          organizacion_id?: string
          razon_social?: string
          rut?: string
        }
        Relationships: [
          {
            foreignKeyName: "empresas_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      envio_estadisticas: {
        Row: {
          aceptados: number
          envio_id: string
          informados: number
          organizacion_id: string
          rechazados: number
          reparos: number
          tipo_dte: number
        }
        Insert: {
          aceptados?: number
          envio_id: string
          informados?: number
          organizacion_id: string
          rechazados?: number
          reparos?: number
          tipo_dte: number
        }
        Update: {
          aceptados?: number
          envio_id?: string
          informados?: number
          organizacion_id?: string
          rechazados?: number
          reparos?: number
          tipo_dte?: number
        }
        Relationships: [
          {
            foreignKeyName: "envio_estadisticas_envio_id_fkey"
            columns: ["envio_id"]
            isOneToOne: false
            referencedRelation: "envios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "envio_estadisticas_envio_id_fkey"
            columns: ["envio_id"]
            isOneToOne: false
            referencedRelation: "v_envios_por_consultar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "envio_estadisticas_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      envio_rechazos: {
        Row: {
          creado_en: string
          descripcion: string | null
          documento_id: string | null
          envio_id: string
          errores: Json
          estado: string
          folio: number
          id: string
          organizacion_id: string
          tipo_dte: number
          tipo_observacion: Database["public"]["Enums"]["tipo_observacion"]
        }
        Insert: {
          creado_en?: string
          descripcion?: string | null
          documento_id?: string | null
          envio_id: string
          errores?: Json
          estado: string
          folio: number
          id?: string
          organizacion_id: string
          tipo_dte: number
          tipo_observacion: Database["public"]["Enums"]["tipo_observacion"]
        }
        Update: {
          creado_en?: string
          descripcion?: string | null
          documento_id?: string | null
          envio_id?: string
          errores?: Json
          estado?: string
          folio?: number
          id?: string
          organizacion_id?: string
          tipo_dte?: number
          tipo_observacion?: Database["public"]["Enums"]["tipo_observacion"]
        }
        Relationships: [
          {
            foreignKeyName: "envio_rechazos_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "documentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "envio_rechazos_envio_id_fkey"
            columns: ["envio_id"]
            isOneToOne: false
            referencedRelation: "envios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "envio_rechazos_envio_id_fkey"
            columns: ["envio_id"]
            isOneToOne: false
            referencedRelation: "v_envios_por_consultar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "envio_rechazos_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      envios: {
        Row: {
          aceptados: number
          actualizado_en: string
          ambiente: Database["public"]["Enums"]["ambiente_sii"]
          canal: Database["public"]["Enums"]["canal_sii"]
          certificado_id: string | null
          clasificacion:
            | Database["public"]["Enums"]["clasificacion_envio"]
            | null
          consultas: number
          creado_en: string
          empresa_id: string
          enviado_en: string | null
          error: string | null
          estado_sii: string | null
          fch_resol: string
          fecha_recepcion: string | null
          glosa_sii: string | null
          id: string
          incierto: boolean
          informados: number
          nombre_archivo: string | null
          nro_resol: number
          organizacion_id: string
          proposito: Database["public"]["Enums"]["proposito_envio"]
          rechazados: number
          reparos: number
          respuesta_estado: Json | null
          respuesta_subida: Json | null
          rut_envia: string
          tmst_firma: string | null
          track_id: string | null
          ultima_consulta_en: string | null
          xml_path: string | null
        }
        Insert: {
          aceptados?: number
          actualizado_en?: string
          ambiente: Database["public"]["Enums"]["ambiente_sii"]
          canal?: Database["public"]["Enums"]["canal_sii"]
          certificado_id?: string | null
          clasificacion?:
            | Database["public"]["Enums"]["clasificacion_envio"]
            | null
          consultas?: number
          creado_en?: string
          empresa_id: string
          enviado_en?: string | null
          error?: string | null
          estado_sii?: string | null
          fch_resol: string
          fecha_recepcion?: string | null
          glosa_sii?: string | null
          id?: string
          incierto?: boolean
          informados?: number
          nombre_archivo?: string | null
          nro_resol: number
          organizacion_id: string
          proposito?: Database["public"]["Enums"]["proposito_envio"]
          rechazados?: number
          reparos?: number
          respuesta_estado?: Json | null
          respuesta_subida?: Json | null
          rut_envia: string
          tmst_firma?: string | null
          track_id?: string | null
          ultima_consulta_en?: string | null
          xml_path?: string | null
        }
        Update: {
          aceptados?: number
          actualizado_en?: string
          ambiente?: Database["public"]["Enums"]["ambiente_sii"]
          canal?: Database["public"]["Enums"]["canal_sii"]
          certificado_id?: string | null
          clasificacion?:
            | Database["public"]["Enums"]["clasificacion_envio"]
            | null
          consultas?: number
          creado_en?: string
          empresa_id?: string
          enviado_en?: string | null
          error?: string | null
          estado_sii?: string | null
          fch_resol?: string
          fecha_recepcion?: string | null
          glosa_sii?: string | null
          id?: string
          incierto?: boolean
          informados?: number
          nombre_archivo?: string | null
          nro_resol?: number
          organizacion_id?: string
          proposito?: Database["public"]["Enums"]["proposito_envio"]
          rechazados?: number
          reparos?: number
          respuesta_estado?: Json | null
          respuesta_subida?: Json | null
          rut_envia?: string
          tmst_firma?: string | null
          track_id?: string | null
          ultima_consulta_en?: string | null
          xml_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "envios_certificado_id_fkey"
            columns: ["certificado_id"]
            isOneToOne: false
            referencedRelation: "certificados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "envios_certificado_id_fkey"
            columns: ["certificado_id"]
            isOneToOne: false
            referencedRelation: "v_certificados_estado"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "envios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "envios_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      estados_sii: {
        Row: {
          codigo: string
          en_proceso: boolean
          es_rechazo: boolean
          glosa: string
        }
        Insert: {
          codigo: string
          en_proceso?: boolean
          es_rechazo?: boolean
          glosa: string
        }
        Update: {
          codigo?: string
          en_proceso?: boolean
          es_rechazo?: boolean
          glosa?: string
        }
        Relationships: []
      }
      folios_anulados: {
        Row: {
          anulado_por: string | null
          caf_id: string
          creado_en: string
          folio: number
          id: string
          motivo: string | null
          organizacion_id: string
        }
        Insert: {
          anulado_por?: string | null
          caf_id: string
          creado_en?: string
          folio: number
          id?: string
          motivo?: string | null
          organizacion_id: string
        }
        Update: {
          anulado_por?: string | null
          caf_id?: string
          creado_en?: string
          folio?: number
          id?: string
          motivo?: string | null
          organizacion_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "folios_anulados_caf_id_fkey"
            columns: ["caf_id"]
            isOneToOne: false
            referencedRelation: "cafs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folios_anulados_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      invitaciones: {
        Row: {
          aceptada_en: string | null
          correo: string
          creado_en: string
          expira_en: string
          id: string
          invitado_por: string | null
          organizacion_id: string
          rol: Database["public"]["Enums"]["rol_miembro"]
          token_hash: string
        }
        Insert: {
          aceptada_en?: string | null
          correo: string
          creado_en?: string
          expira_en?: string
          id?: string
          invitado_por?: string | null
          organizacion_id: string
          rol?: Database["public"]["Enums"]["rol_miembro"]
          token_hash: string
        }
        Update: {
          aceptada_en?: string | null
          correo?: string
          creado_en?: string
          expira_en?: string
          id?: string
          invitado_por?: string | null
          organizacion_id?: string
          rol?: Database["public"]["Enums"]["rol_miembro"]
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitaciones_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      miembros_organizacion: {
        Row: {
          creado_en: string
          organizacion_id: string
          rol: Database["public"]["Enums"]["rol_miembro"]
          usuario_id: string
        }
        Insert: {
          creado_en?: string
          organizacion_id: string
          rol?: Database["public"]["Enums"]["rol_miembro"]
          usuario_id: string
        }
        Update: {
          creado_en?: string
          organizacion_id?: string
          rol?: Database["public"]["Enums"]["rol_miembro"]
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "miembros_organizacion_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      operaciones_sii: {
        Row: {
          ambiente: Database["public"]["Enums"]["ambiente_sii"]
          api_key_id: string | null
          canal: Database["public"]["Enums"]["canal_sii"] | null
          confirmada: boolean
          detalle: Json
          documento_id: string | null
          empresa_id: string | null
          envio_id: string | null
          id: string
          iniciada_en: string
          mensaje: string | null
          operacion: Database["public"]["Enums"]["operacion_sii"]
          organizacion_id: string
          resultado: Database["public"]["Enums"]["resultado_operacion"]
          solicitud_id: string | null
          terminada_en: string | null
          usuario_id: string | null
        }
        Insert: {
          ambiente: Database["public"]["Enums"]["ambiente_sii"]
          api_key_id?: string | null
          canal?: Database["public"]["Enums"]["canal_sii"] | null
          confirmada?: boolean
          detalle?: Json
          documento_id?: string | null
          empresa_id?: string | null
          envio_id?: string | null
          id?: string
          iniciada_en?: string
          mensaje?: string | null
          operacion: Database["public"]["Enums"]["operacion_sii"]
          organizacion_id: string
          resultado?: Database["public"]["Enums"]["resultado_operacion"]
          solicitud_id?: string | null
          terminada_en?: string | null
          usuario_id?: string | null
        }
        Update: {
          ambiente?: Database["public"]["Enums"]["ambiente_sii"]
          api_key_id?: string | null
          canal?: Database["public"]["Enums"]["canal_sii"] | null
          confirmada?: boolean
          detalle?: Json
          documento_id?: string | null
          empresa_id?: string | null
          envio_id?: string | null
          id?: string
          iniciada_en?: string
          mensaje?: string | null
          operacion?: Database["public"]["Enums"]["operacion_sii"]
          organizacion_id?: string
          resultado?: Database["public"]["Enums"]["resultado_operacion"]
          solicitud_id?: string | null
          terminada_en?: string | null
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operaciones_api_key_fk"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operaciones_sii_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "documentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operaciones_sii_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operaciones_sii_envio_id_fkey"
            columns: ["envio_id"]
            isOneToOne: false
            referencedRelation: "envios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operaciones_sii_envio_id_fkey"
            columns: ["envio_id"]
            isOneToOne: false
            referencedRelation: "v_envios_por_consultar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operaciones_sii_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operaciones_sii_solicitud_id_fkey"
            columns: ["solicitud_id"]
            isOneToOne: false
            referencedRelation: "solicitudes_folios"
            referencedColumns: ["id"]
          },
        ]
      }
      organizaciones: {
        Row: {
          actualizado_en: string
          creado_en: string
          creado_por: string | null
          id: string
          nombre: string
          slug: string
        }
        Insert: {
          actualizado_en?: string
          creado_en?: string
          creado_por?: string | null
          id?: string
          nombre: string
          slug: string
        }
        Update: {
          actualizado_en?: string
          creado_en?: string
          creado_por?: string | null
          id?: string
          nombre?: string
          slug?: string
        }
        Relationships: []
      }
      perfiles: {
        Row: {
          actualizado_en: string
          correo: string | null
          creado_en: string
          id: string
          nombre: string | null
          rut: string | null
          tema: string
          ultima_empresa: string | null
          ultima_organizacion: string | null
        }
        Insert: {
          actualizado_en?: string
          correo?: string | null
          creado_en?: string
          id: string
          nombre?: string | null
          rut?: string | null
          tema?: string
          ultima_empresa?: string | null
          ultima_organizacion?: string | null
        }
        Update: {
          actualizado_en?: string
          correo?: string | null
          creado_en?: string
          id?: string
          nombre?: string | null
          rut?: string | null
          tema?: string
          ultima_empresa?: string | null
          ultima_organizacion?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "perfiles_ultima_empresa_fkey"
            columns: ["ultima_empresa"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "perfiles_ultima_organizacion_fkey"
            columns: ["ultima_organizacion"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      planes: {
        Row: {
          activo: boolean
          codigo: string
          creado_en: string
          id: string
          incluye_api: boolean
          incluye_webhooks: boolean
          max_boletas_mes: number | null
          max_empresas: number | null
          max_usuarios: number | null
          nombre: string
          permite_produccion: boolean
          precio_mensual_clp: number
        }
        Insert: {
          activo?: boolean
          codigo: string
          creado_en?: string
          id?: string
          incluye_api?: boolean
          incluye_webhooks?: boolean
          max_boletas_mes?: number | null
          max_empresas?: number | null
          max_usuarios?: number | null
          nombre: string
          permite_produccion?: boolean
          precio_mensual_clp?: number
        }
        Update: {
          activo?: boolean
          codigo?: string
          creado_en?: string
          id?: string
          incluye_api?: boolean
          incluye_webhooks?: boolean
          max_boletas_mes?: number | null
          max_empresas?: number | null
          max_usuarios?: number | null
          nombre?: string
          permite_produccion?: boolean
          precio_mensual_clp?: number
        }
        Relationships: []
      }
      procesos_certificacion: {
        Row: {
          actualizado_en: string
          avisos_postulacion: Json
          boleta_exenta: boolean
          codigo_estado_sii: string | null
          correo_administrador: string | null
          correo_contacto_sii: string | null
          correo_intercambio: string | null
          correo_proveedor: string | null
          correo_proveedor_set: string | null
          creado_en: string
          declarada_en: string | null
          empresa_id: string
          envio_set_id: string | null
          estado_consultado_en: string | null
          etapa: Database["public"]["Enums"]["etapa_certificacion"]
          glosa_estado_sii: string | null
          id: string
          link_consulta: string | null
          nombre_proveedor: string | null
          nombre_software: string | null
          organizacion_id: string
          paso_sii: number | null
          postulada_en: string | null
          revision_solicitada_en: string | null
          rut_administrador: string | null
          rut_proveedor: string | null
          set_descargado_en: string | null
          set_pruebas_texto: string | null
          url: string | null
        }
        Insert: {
          actualizado_en?: string
          avisos_postulacion?: Json
          boleta_exenta?: boolean
          codigo_estado_sii?: string | null
          correo_administrador?: string | null
          correo_contacto_sii?: string | null
          correo_intercambio?: string | null
          correo_proveedor?: string | null
          correo_proveedor_set?: string | null
          creado_en?: string
          declarada_en?: string | null
          empresa_id: string
          envio_set_id?: string | null
          estado_consultado_en?: string | null
          etapa?: Database["public"]["Enums"]["etapa_certificacion"]
          glosa_estado_sii?: string | null
          id?: string
          link_consulta?: string | null
          nombre_proveedor?: string | null
          nombre_software?: string | null
          organizacion_id: string
          paso_sii?: number | null
          postulada_en?: string | null
          revision_solicitada_en?: string | null
          rut_administrador?: string | null
          rut_proveedor?: string | null
          set_descargado_en?: string | null
          set_pruebas_texto?: string | null
          url?: string | null
        }
        Update: {
          actualizado_en?: string
          avisos_postulacion?: Json
          boleta_exenta?: boolean
          codigo_estado_sii?: string | null
          correo_administrador?: string | null
          correo_contacto_sii?: string | null
          correo_intercambio?: string | null
          correo_proveedor?: string | null
          correo_proveedor_set?: string | null
          creado_en?: string
          declarada_en?: string | null
          empresa_id?: string
          envio_set_id?: string | null
          estado_consultado_en?: string | null
          etapa?: Database["public"]["Enums"]["etapa_certificacion"]
          glosa_estado_sii?: string | null
          id?: string
          link_consulta?: string | null
          nombre_proveedor?: string | null
          nombre_software?: string | null
          organizacion_id?: string
          paso_sii?: number | null
          postulada_en?: string | null
          revision_solicitada_en?: string | null
          rut_administrador?: string | null
          rut_proveedor?: string | null
          set_descargado_en?: string | null
          set_pruebas_texto?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "procesos_certificacion_empresa_id_envio_set_id_fkey"
            columns: ["empresa_id", "envio_set_id"]
            isOneToOne: false
            referencedRelation: "envios"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "procesos_certificacion_empresa_id_envio_set_id_fkey"
            columns: ["empresa_id", "envio_set_id"]
            isOneToOne: false
            referencedRelation: "v_envios_por_consultar"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "procesos_certificacion_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: true
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procesos_certificacion_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      productos: {
        Row: {
          activo: boolean
          actualizado_en: string
          codigo: string | null
          creado_en: string
          empresa_id: string
          exento: boolean
          id: string
          nombre: string
          organizacion_id: string
          precio_bruto: number
          unidad: string | null
        }
        Insert: {
          activo?: boolean
          actualizado_en?: string
          codigo?: string | null
          creado_en?: string
          empresa_id: string
          exento?: boolean
          id?: string
          nombre: string
          organizacion_id: string
          precio_bruto: number
          unidad?: string | null
        }
        Update: {
          activo?: boolean
          actualizado_en?: string
          codigo?: string | null
          creado_en?: string
          empresa_id?: string
          exento?: boolean
          id?: string
          nombre?: string
          organizacion_id?: string
          precio_bruto?: number
          unidad?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "productos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productos_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      rcof: {
        Row: {
          ambiente: Database["public"]["Enums"]["ambiente_sii"]
          creado_en: string
          empresa_id: string
          envio_id: string | null
          fch_final: string
          fch_inicio: string
          id: string
          organizacion_id: string
          resumenes: Json
          sec_envio: number
        }
        Insert: {
          ambiente: Database["public"]["Enums"]["ambiente_sii"]
          creado_en?: string
          empresa_id: string
          envio_id?: string | null
          fch_final: string
          fch_inicio: string
          id?: string
          organizacion_id: string
          resumenes: Json
          sec_envio?: number
        }
        Update: {
          ambiente?: Database["public"]["Enums"]["ambiente_sii"]
          creado_en?: string
          empresa_id?: string
          envio_id?: string | null
          fch_final?: string
          fch_inicio?: string
          id?: string
          organizacion_id?: string
          resumenes?: Json
          sec_envio?: number
        }
        Relationships: [
          {
            foreignKeyName: "rcof_empresa_id_envio_id_fkey"
            columns: ["empresa_id", "envio_id"]
            isOneToOne: false
            referencedRelation: "envios"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "rcof_empresa_id_envio_id_fkey"
            columns: ["empresa_id", "envio_id"]
            isOneToOne: false
            referencedRelation: "v_envios_por_consultar"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "rcof_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rcof_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      receptores: {
        Row: {
          actualizado_en: string
          correo: string | null
          creado_en: string
          empresa_id: string
          id: string
          organizacion_id: string
          razon_social: string
          rut: string
        }
        Insert: {
          actualizado_en?: string
          correo?: string | null
          creado_en?: string
          empresa_id: string
          id?: string
          organizacion_id: string
          razon_social: string
          rut: string
        }
        Update: {
          actualizado_en?: string
          correo?: string | null
          creado_en?: string
          empresa_id?: string
          id?: string
          organizacion_id?: string
          razon_social?: string
          rut?: string
        }
        Relationships: [
          {
            foreignKeyName: "receptores_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receptores_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      resoluciones: {
        Row: {
          ambiente: Database["public"]["Enums"]["ambiente_sii"]
          creado_en: string
          empresa_id: string
          fecha: string
          id: string
          numero: number
          organizacion_id: string
          vigente: boolean
        }
        Insert: {
          ambiente: Database["public"]["Enums"]["ambiente_sii"]
          creado_en?: string
          empresa_id: string
          fecha: string
          id?: string
          numero: number
          organizacion_id: string
          vigente?: boolean
        }
        Update: {
          ambiente?: Database["public"]["Enums"]["ambiente_sii"]
          creado_en?: string
          empresa_id?: string
          fecha?: string
          id?: string
          numero?: number
          organizacion_id?: string
          vigente?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "resoluciones_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resoluciones_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      sesiones_sii: {
        Row: {
          ambiente: Database["public"]["Enums"]["ambiente_sii"]
          certificado_id: string
          cookies_cifradas: string
          creado_en: string
          expira_en: string | null
          ultimo_uso_en: string
        }
        Insert: {
          ambiente: Database["public"]["Enums"]["ambiente_sii"]
          certificado_id: string
          cookies_cifradas: string
          creado_en?: string
          expira_en?: string | null
          ultimo_uso_en?: string
        }
        Update: {
          ambiente?: Database["public"]["Enums"]["ambiente_sii"]
          certificado_id?: string
          cookies_cifradas?: string
          creado_en?: string
          expira_en?: string | null
          ultimo_uso_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "sesiones_sii_certificado_id_fkey"
            columns: ["certificado_id"]
            isOneToOne: false
            referencedRelation: "certificados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sesiones_sii_certificado_id_fkey"
            columns: ["certificado_id"]
            isOneToOne: false
            referencedRelation: "v_certificados_estado"
            referencedColumns: ["id"]
          },
        ]
      }
      set_pruebas_casos: {
        Row: {
          creado_en: string
          detalles: Json
          documento_id: string | null
          id: string
          numero_caso: number
          organizacion_id: string
          proceso_id: string
          referencia_codigo: string
          referencia_razon: string
          tipo_dte: number
        }
        Insert: {
          creado_en?: string
          detalles: Json
          documento_id?: string | null
          id?: string
          numero_caso: number
          organizacion_id: string
          proceso_id: string
          referencia_codigo?: string
          referencia_razon: string
          tipo_dte: number
        }
        Update: {
          creado_en?: string
          detalles?: Json
          documento_id?: string | null
          id?: string
          numero_caso?: number
          organizacion_id?: string
          proceso_id?: string
          referencia_codigo?: string
          referencia_razon?: string
          tipo_dte?: number
        }
        Relationships: [
          {
            foreignKeyName: "set_pruebas_casos_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "documentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "set_pruebas_casos_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "set_pruebas_casos_proceso_id_fkey"
            columns: ["proceso_id"]
            isOneToOne: false
            referencedRelation: "procesos_certificacion"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "set_pruebas_casos_tipo_dte_fkey"
            columns: ["tipo_dte"]
            isOneToOne: false
            referencedRelation: "tipos_dte"
            referencedColumns: ["codigo"]
          },
        ]
      }
      solicitudes_folios: {
        Row: {
          ambiente: Database["public"]["Enums"]["ambiente_sii"]
          caf_id: string | null
          cantidad: number
          certificado_id: string | null
          confirmada: boolean
          creado_en: string
          empresa_id: string
          estado: Database["public"]["Enums"]["estado_solicitud_folios"]
          folio_desde: number | null
          folio_hasta: number | null
          folio_inicial: number | null
          id: string
          mensaje: string | null
          organizacion_id: string
          solicitado_por: string | null
          terminado_en: string | null
          tipo_dte: number
        }
        Insert: {
          ambiente: Database["public"]["Enums"]["ambiente_sii"]
          caf_id?: string | null
          cantidad: number
          certificado_id?: string | null
          confirmada?: boolean
          creado_en?: string
          empresa_id: string
          estado?: Database["public"]["Enums"]["estado_solicitud_folios"]
          folio_desde?: number | null
          folio_hasta?: number | null
          folio_inicial?: number | null
          id?: string
          mensaje?: string | null
          organizacion_id: string
          solicitado_por?: string | null
          terminado_en?: string | null
          tipo_dte: number
        }
        Update: {
          ambiente?: Database["public"]["Enums"]["ambiente_sii"]
          caf_id?: string | null
          cantidad?: number
          certificado_id?: string | null
          confirmada?: boolean
          creado_en?: string
          empresa_id?: string
          estado?: Database["public"]["Enums"]["estado_solicitud_folios"]
          folio_desde?: number | null
          folio_hasta?: number | null
          folio_inicial?: number | null
          id?: string
          mensaje?: string | null
          organizacion_id?: string
          solicitado_por?: string | null
          terminado_en?: string | null
          tipo_dte?: number
        }
        Relationships: [
          {
            foreignKeyName: "solicitudes_folios_caf_id_fkey"
            columns: ["caf_id"]
            isOneToOne: false
            referencedRelation: "cafs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_folios_certificado_id_fkey"
            columns: ["certificado_id"]
            isOneToOne: false
            referencedRelation: "certificados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_folios_certificado_id_fkey"
            columns: ["certificado_id"]
            isOneToOne: false
            referencedRelation: "v_certificados_estado"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_folios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_folios_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_folios_tipo_dte_fkey"
            columns: ["tipo_dte"]
            isOneToOne: false
            referencedRelation: "tipos_dte"
            referencedColumns: ["codigo"]
          },
        ]
      }
      suscripciones: {
        Row: {
          actualizado_en: string
          creado_en: string
          estado: Database["public"]["Enums"]["estado_suscripcion"]
          id: string
          id_externo: string | null
          organizacion_id: string
          periodo_fin: string | null
          periodo_inicio: string
          plan_id: string
          proveedor_pago: string | null
        }
        Insert: {
          actualizado_en?: string
          creado_en?: string
          estado?: Database["public"]["Enums"]["estado_suscripcion"]
          id?: string
          id_externo?: string | null
          organizacion_id: string
          periodo_fin?: string | null
          periodo_inicio?: string
          plan_id: string
          proveedor_pago?: string | null
        }
        Update: {
          actualizado_en?: string
          creado_en?: string
          estado?: Database["public"]["Enums"]["estado_suscripcion"]
          id?: string
          id_externo?: string | null
          organizacion_id?: string
          periodo_fin?: string | null
          periodo_inicio?: string
          plan_id?: string
          proveedor_pago?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suscripciones_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suscripciones_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "planes"
            referencedColumns: ["id"]
          },
        ]
      }
      tipos_dte: {
        Row: {
          afecto_iva: boolean
          codigo: number
          nombre: string
        }
        Insert: {
          afecto_iva: boolean
          codigo: number
          nombre: string
        }
        Update: {
          afecto_iva?: boolean
          codigo?: number
          nombre?: string
        }
        Relationships: []
      }
      tokens_sii: {
        Row: {
          actualizado_en: string
          ambiente: Database["public"]["Enums"]["ambiente_sii"]
          canal: Database["public"]["Enums"]["canal_sii"]
          huella_certificado: string
          rut_empresa: string
          token_cifrado: string
          vence_en: string
        }
        Insert: {
          actualizado_en?: string
          ambiente: Database["public"]["Enums"]["ambiente_sii"]
          canal: Database["public"]["Enums"]["canal_sii"]
          huella_certificado: string
          rut_empresa: string
          token_cifrado: string
          vence_en: string
        }
        Update: {
          actualizado_en?: string
          ambiente?: Database["public"]["Enums"]["ambiente_sii"]
          canal?: Database["public"]["Enums"]["canal_sii"]
          huella_certificado?: string
          rut_empresa?: string
          token_cifrado?: string
          vence_en?: string
        }
        Relationships: []
      }
      uso_mensual: {
        Row: {
          boletas_certificacion: number
          boletas_produccion: number
          envios: number
          folios_timbrados: number
          organizacion_id: string
          periodo: string
        }
        Insert: {
          boletas_certificacion?: number
          boletas_produccion?: number
          envios?: number
          folios_timbrados?: number
          organizacion_id: string
          periodo: string
        }
        Update: {
          boletas_certificacion?: number
          boletas_produccion?: number
          envios?: number
          folios_timbrados?: number
          organizacion_id?: string
          periodo?: string
        }
        Relationships: [
          {
            foreignKeyName: "uso_mensual_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_entregas: {
        Row: {
          creado_en: string
          entregado_en: string | null
          estado: Database["public"]["Enums"]["estado_entrega_webhook"]
          evento: string
          id: number
          intentos: number
          organizacion_id: string
          payload: Json
          siguiente_intento_en: string
          ultima_respuesta: string | null
          ultimo_status_http: number | null
          webhook_id: string
        }
        Insert: {
          creado_en?: string
          entregado_en?: string | null
          estado?: Database["public"]["Enums"]["estado_entrega_webhook"]
          evento: string
          id?: never
          intentos?: number
          organizacion_id: string
          payload: Json
          siguiente_intento_en?: string
          ultima_respuesta?: string | null
          ultimo_status_http?: number | null
          webhook_id: string
        }
        Update: {
          creado_en?: string
          entregado_en?: string | null
          estado?: Database["public"]["Enums"]["estado_entrega_webhook"]
          evento?: string
          id?: never
          intentos?: number
          organizacion_id?: string
          payload?: Json
          siguiente_intento_en?: string
          ultima_respuesta?: string | null
          ultimo_status_http?: number | null
          webhook_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_entregas_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_entregas_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: false
            referencedRelation: "webhooks"
            referencedColumns: ["id"]
          },
        ]
      }
      webhooks: {
        Row: {
          activo: boolean
          actualizado_en: string
          creado_en: string
          eventos: string[]
          id: string
          organizacion_id: string
          secreto_secret_id: string
          url: string
        }
        Insert: {
          activo?: boolean
          actualizado_en?: string
          creado_en?: string
          eventos: string[]
          id?: string
          organizacion_id: string
          secreto_secret_id: string
          url: string
        }
        Update: {
          activo?: boolean
          actualizado_en?: string
          creado_en?: string
          eventos?: string[]
          id?: string
          organizacion_id?: string
          secreto_secret_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhooks_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_certificados_estado: {
        Row: {
          cn: string | null
          dias_restantes: number | null
          estado: string | null
          id: string | null
          nombre_titular: string | null
          organizacion_id: string | null
          rut_titular: string | null
          vigente_desde: string | null
          vigente_hasta: string | null
        }
        Insert: {
          cn?: string | null
          dias_restantes?: never
          estado?: never
          id?: string | null
          nombre_titular?: string | null
          organizacion_id?: string | null
          rut_titular?: string | null
          vigente_desde?: string | null
          vigente_hasta?: string | null
        }
        Update: {
          cn?: string | null
          dias_restantes?: never
          estado?: never
          id?: string | null
          nombre_titular?: string | null
          organizacion_id?: string | null
          rut_titular?: string | null
          vigente_desde?: string | null
          vigente_hasta?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "certificados_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      v_envios_por_consultar: {
        Row: {
          aceptados: number | null
          actualizado_en: string | null
          ambiente: Database["public"]["Enums"]["ambiente_sii"] | null
          canal: Database["public"]["Enums"]["canal_sii"] | null
          certificado_id: string | null
          clasificacion:
            | Database["public"]["Enums"]["clasificacion_envio"]
            | null
          consultas: number | null
          creado_en: string | null
          empresa_id: string | null
          enviado_en: string | null
          error: string | null
          estado_sii: string | null
          fch_resol: string | null
          fecha_recepcion: string | null
          glosa_sii: string | null
          id: string | null
          incierto: boolean | null
          informados: number | null
          nombre_archivo: string | null
          nro_resol: number | null
          organizacion_id: string | null
          proposito: Database["public"]["Enums"]["proposito_envio"] | null
          rechazados: number | null
          reparos: number | null
          respuesta_estado: Json | null
          respuesta_subida: Json | null
          rut_envia: string | null
          tmst_firma: string | null
          track_id: string | null
          ultima_consulta_en: string | null
          xml_path: string | null
        }
        Insert: {
          aceptados?: number | null
          actualizado_en?: string | null
          ambiente?: Database["public"]["Enums"]["ambiente_sii"] | null
          canal?: Database["public"]["Enums"]["canal_sii"] | null
          certificado_id?: string | null
          clasificacion?:
            | Database["public"]["Enums"]["clasificacion_envio"]
            | null
          consultas?: number | null
          creado_en?: string | null
          empresa_id?: string | null
          enviado_en?: string | null
          error?: string | null
          estado_sii?: string | null
          fch_resol?: string | null
          fecha_recepcion?: string | null
          glosa_sii?: string | null
          id?: string | null
          incierto?: boolean | null
          informados?: number | null
          nombre_archivo?: string | null
          nro_resol?: number | null
          organizacion_id?: string | null
          proposito?: Database["public"]["Enums"]["proposito_envio"] | null
          rechazados?: number | null
          reparos?: number | null
          respuesta_estado?: Json | null
          respuesta_subida?: Json | null
          rut_envia?: string | null
          tmst_firma?: string | null
          track_id?: string | null
          ultima_consulta_en?: string | null
          xml_path?: string | null
        }
        Update: {
          aceptados?: number | null
          actualizado_en?: string | null
          ambiente?: Database["public"]["Enums"]["ambiente_sii"] | null
          canal?: Database["public"]["Enums"]["canal_sii"] | null
          certificado_id?: string | null
          clasificacion?:
            | Database["public"]["Enums"]["clasificacion_envio"]
            | null
          consultas?: number | null
          creado_en?: string | null
          empresa_id?: string | null
          enviado_en?: string | null
          error?: string | null
          estado_sii?: string | null
          fch_resol?: string | null
          fecha_recepcion?: string | null
          glosa_sii?: string | null
          id?: string | null
          incierto?: boolean | null
          informados?: number | null
          nombre_archivo?: string | null
          nro_resol?: number | null
          organizacion_id?: string | null
          proposito?: Database["public"]["Enums"]["proposito_envio"] | null
          rechazados?: number | null
          reparos?: number | null
          respuesta_estado?: Json | null
          respuesta_subida?: Json | null
          rut_envia?: string | null
          tmst_firma?: string | null
          track_id?: string | null
          ultima_consulta_en?: string | null
          xml_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "envios_certificado_id_fkey"
            columns: ["certificado_id"]
            isOneToOne: false
            referencedRelation: "certificados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "envios_certificado_id_fkey"
            columns: ["certificado_id"]
            isOneToOne: false
            referencedRelation: "v_certificados_estado"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "envios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "envios_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      v_folios_disponibles: {
        Row: {
          ambiente: Database["public"]["Enums"]["ambiente_sii"] | null
          cafs_activos: number | null
          empresa_id: string | null
          folios_disponibles: number | null
          organizacion_id: string | null
          proximo_folio: number | null
          tipo_dte: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cafs_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cafs_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cafs_tipo_dte_fkey"
            columns: ["tipo_dte"]
            isOneToOne: false
            referencedRelation: "tipos_dte"
            referencedColumns: ["codigo"]
          },
        ]
      }
      v_ventas_diarias: {
        Row: {
          ambiente: Database["public"]["Enums"]["ambiente_sii"] | null
          documentos: number | null
          empresa_id: string | null
          fecha_emision: string | null
          folio_max: number | null
          folio_min: number | null
          iva: number | null
          mnt_exe: number | null
          mnt_neto: number | null
          mnt_total: number | null
          organizacion_id: string | null
          tipo_dte: number | null
        }
        Relationships: [
          {
            foreignKeyName: "documentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_tipo_dte_fkey"
            columns: ["tipo_dte"]
            isOneToOne: false
            referencedRelation: "tipos_dte"
            referencedColumns: ["codigo"]
          },
        ]
      }
    }
    Functions: {
      aceptar_invitacion: { Args: { p_token: string }; Returns: string }
      asignar_folio: {
        Args: {
          p_ambiente: Database["public"]["Enums"]["ambiente_sii"]
          p_empresa: string
          p_tipo_dte: number
        }
        Returns: {
          caf_id: string
          folio: number
        }[]
      }
      clasificar_envio: {
        Args: {
          p_aceptados: number
          p_estado: string
          p_incierto: boolean
          p_informados: number
          p_rechazados: number
          p_reparos: number
        }
        Returns: Database["public"]["Enums"]["clasificacion_envio"]
      }
      comparte_organizacion: { Args: { p_usuario: string }; Returns: boolean }
      correo_sii_valido: { Args: { p_correo: string }; Returns: boolean }
      crear_api_key: {
        Args: {
          p_alcances?: string[]
          p_ambiente?: Database["public"]["Enums"]["ambiente_sii"]
          p_empresa?: string
          p_expira_en?: string
          p_nombre: string
          p_organizacion: string
        }
        Returns: string
      }
      crear_invitacion: {
        Args: {
          p_correo: string
          p_organizacion: string
          p_rol?: Database["public"]["Enums"]["rol_miembro"]
        }
        Returns: string
      }
      crear_organizacion: {
        Args: { p_nombre: string; p_slug: string }
        Returns: string
      }
      crear_webhook: {
        Args: { p_eventos: string[]; p_organizacion: string; p_url: string }
        Returns: {
          secreto: string
          webhook_id: string
        }[]
      }
      encolar_evento: {
        Args: { p_evento: string; p_organizacion: string; p_payload: Json }
        Returns: undefined
      }
      es_admin: { Args: { p_organizacion: string }; Returns: boolean }
      es_miembro: { Args: { p_organizacion: string }; Returns: boolean }
      exigir_cupo_usuarios: {
        Args: { p_organizacion: string }
        Returns: undefined
      }
      fijar_certificado_predeterminado: {
        Args: { p_certificado: string; p_empresa: string }
        Returns: undefined
      }
      guardar_secreto: {
        Args: { p_descripcion?: string; p_secreto: string }
        Returns: string
      }
      leer_secreto: { Args: { p_id: string }; Returns: string }
      liberar_bloqueo_certificado: {
        Args: {
          p_ambiente: Database["public"]["Enums"]["ambiente_sii"]
          p_certificado: string
          p_titular: string
        }
        Returns: boolean
      }
      plan_vigente: {
        Args: { p_organizacion: string }
        Returns: {
          activo: boolean
          codigo: string
          creado_en: string
          id: string
          incluye_api: boolean
          incluye_webhooks: boolean
          max_boletas_mes: number | null
          max_empresas: number | null
          max_usuarios: number | null
          nombre: string
          permite_produccion: boolean
          precio_mensual_clp: number
        }
        SetofOptions: {
          from: "*"
          to: "planes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      puede_emitir: { Args: { p_organizacion: string }; Returns: boolean }
      registrar_certificado: {
        Args: {
          p_clave: string
          p_cn: string
          p_emisor_ca: string
          p_huella_sha256: string
          p_nombre_titular: string
          p_organizacion: string
          p_pfx_base64: string
          p_pfx_legacy: boolean
          p_rut_titular: string
          p_subido_por: string
          p_vigente_desde: string
          p_vigente_hasta: string
        }
        Returns: string
      }
      registrar_resolucion: {
        Args: {
          p_ambiente: Database["public"]["Enums"]["ambiente_sii"]
          p_empresa: string
          p_fecha: string
          p_numero: number
        }
        Returns: string
      }
      rut_valido: { Args: { p_rut: string }; Returns: boolean }
      sincronizar_documentos_envio: {
        Args: { p_envio: string }
        Returns: undefined
      }
      tiene_rol: {
        Args: {
          p_organizacion: string
          p_roles: Database["public"]["Enums"]["rol_miembro"][]
        }
        Returns: boolean
      }
      token_aleatorio: { Args: never; Returns: string }
      token_borrar: {
        Args: {
          p_ambiente: Database["public"]["Enums"]["ambiente_sii"]
          p_canal: Database["public"]["Enums"]["canal_sii"]
          p_huella: string
          p_rut: string
        }
        Returns: undefined
      }
      token_guardar: {
        Args: {
          p_ambiente: Database["public"]["Enums"]["ambiente_sii"]
          p_canal: Database["public"]["Enums"]["canal_sii"]
          p_huella: string
          p_rut: string
          p_token_cifrado: string
          p_vence_en: string
        }
        Returns: undefined
      }
      token_obtener: {
        Args: {
          p_ambiente: Database["public"]["Enums"]["ambiente_sii"]
          p_canal: Database["public"]["Enums"]["canal_sii"]
          p_huella: string
          p_rut: string
        }
        Returns: {
          token_cifrado: string
          vence_en: string
        }[]
      }
      tomar_bloqueo_certificado: {
        Args: {
          p_ambiente: Database["public"]["Enums"]["ambiente_sii"]
          p_certificado: string
          p_segundos: number
          p_titular: string
        }
        Returns: boolean
      }
      uuid_o_nulo: { Args: { p_texto: string }; Returns: string }
      ver_invitacion: {
        Args: { p_token: string }
        Returns: {
          correo: string
          expira_en: string
          organizacion_nombre: string
          rol: Database["public"]["Enums"]["rol_miembro"]
        }[]
      }
    }
    Enums: {
      ambiente_sii: "certificacion" | "produccion"
      canal_sii: "rest" | "soap"
      clasificacion_envio:
        | "pendiente"
        | "incierto"
        | "en_proceso"
        | "aceptado"
        | "aceptado_con_reparos"
        | "rechazado"
        | "inconsistente"
      estado_caf: "activo" | "agotado" | "anulado"
      estado_documento:
        | "borrador"
        | "firmado"
        | "enviado"
        | "incierto"
        | "aceptado"
        | "aceptado_con_reparos"
        | "rechazado"
        | "anulado"
      estado_entrega_webhook:
        | "pendiente"
        | "entregado"
        | "fallido"
        | "descartado"
      estado_solicitud_folios:
        | "en_curso"
        | "simulada"
        | "timbrada"
        | "incierta"
        | "rechazada"
        | "error"
      estado_suscripcion: "prueba" | "activa" | "morosa" | "cancelada"
      etapa_certificacion:
        | "borrador"
        | "postulada"
        | "set_descargado"
        | "set_enviado"
        | "set_aceptado"
        | "revision_solicitada"
        | "por_declarar"
        | "autorizada"
      operacion_sii:
        | "autenticar"
        | "obtener_token"
        | "postular"
        | "descargar_set"
        | "solicitar_folios"
        | "enviar_set"
        | "estado_envio"
        | "solicitar_revision"
        | "verificar_portal"
        | "estado_declaracion"
        | "declarar"
        | "enviar_rcof"
        | "emitir"
        | "consultar_envio"
        | "seguimiento"
      origen_documento: "panel" | "api" | "cli" | "set_pruebas"
      proposito_envio: "emision" | "set_pruebas" | "rcof"
      resultado_operacion:
        | "en_curso"
        | "ok"
        | "error"
        | "uso"
        | "config"
        | "transporte"
        | "rechazo_sii"
        | "incierto"
        | "verificacion_fallida"
      rol_miembro: "propietario" | "administrador" | "emisor" | "lector"
      tipo_descuento: "monto" | "porcentaje"
      tipo_observacion: "rechazo" | "reparo"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      ambiente_sii: ["certificacion", "produccion"],
      canal_sii: ["rest", "soap"],
      clasificacion_envio: [
        "pendiente",
        "incierto",
        "en_proceso",
        "aceptado",
        "aceptado_con_reparos",
        "rechazado",
        "inconsistente",
      ],
      estado_caf: ["activo", "agotado", "anulado"],
      estado_documento: [
        "borrador",
        "firmado",
        "enviado",
        "incierto",
        "aceptado",
        "aceptado_con_reparos",
        "rechazado",
        "anulado",
      ],
      estado_entrega_webhook: [
        "pendiente",
        "entregado",
        "fallido",
        "descartado",
      ],
      estado_solicitud_folios: [
        "en_curso",
        "simulada",
        "timbrada",
        "incierta",
        "rechazada",
        "error",
      ],
      estado_suscripcion: ["prueba", "activa", "morosa", "cancelada"],
      etapa_certificacion: [
        "borrador",
        "postulada",
        "set_descargado",
        "set_enviado",
        "set_aceptado",
        "revision_solicitada",
        "por_declarar",
        "autorizada",
      ],
      operacion_sii: [
        "autenticar",
        "obtener_token",
        "postular",
        "descargar_set",
        "solicitar_folios",
        "enviar_set",
        "estado_envio",
        "solicitar_revision",
        "verificar_portal",
        "estado_declaracion",
        "declarar",
        "enviar_rcof",
        "emitir",
        "consultar_envio",
        "seguimiento",
      ],
      origen_documento: ["panel", "api", "cli", "set_pruebas"],
      proposito_envio: ["emision", "set_pruebas", "rcof"],
      resultado_operacion: [
        "en_curso",
        "ok",
        "error",
        "uso",
        "config",
        "transporte",
        "rechazo_sii",
        "incierto",
        "verificacion_fallida",
      ],
      rol_miembro: ["propietario", "administrador", "emisor", "lector"],
      tipo_descuento: ["monto", "porcentaje"],
      tipo_observacion: ["rechazo", "reparo"],
    },
  },
} as const
