# Incidentes e SLA

## Autoridade dos incidentes

Os relatórios não detectam nem alteram incidentes. A única autoridade continua sendo o motor de monitoramento:

- três falhas elegíveis consecutivas confirmam um incidente;
- duas verificações consecutivas bem-sucedidas confirmam a recuperação.

Warnings HTTP (incluindo 401, 403 e 429) e bloqueios de segurança não criam downtime por conta própria.

## Período observado

Para um período selecionado `[início, fim)`, a RPC deriva o intervalo esperado de `sites.check_interval` por `monitor_interval_value(...)`. A tolerância operacional é o maior valor entre duas vezes o intervalo e o intervalo mais cinco minutos.

Cobertura completa exige simultaneamente:

- check utilizável próximo ao início;
- check utilizável próximo ao fim;
- nenhum gap entre checks maior que a tolerância.

Warnings HTTP comprovam observação; bloqueios `security_blocked` não. O estado `is_active` atual não participa dessa decisão, pois não comprova como o site estava em um período histórico.

Se o site começou a ser monitorado no meio do período ou deixou de ser observado antes do fim, `observedStart` e `observedEnd` delimitam a parte contínua conhecida. O valor parcial pode ser mostrado como informativo, mas o status permanece `Dados insuficientes`. Se houver gap interno anormal, a disponibilidade, o downtime permitido e a margem ficam indisponíveis: o tempo desconhecido nunca é tratado como uptime.

## Fórmula

Cada incidente confirmado é recortado ao período observado. Em seguida, intervalos sobrepostos são unidos antes da soma:

```text
início efetivo = máximo(início do incidente, início observado)
fim efetivo = mínimo(resolved_at ou fim do período, fim do período)
downtime do incidente = máximo(0, fim efetivo - início efetivo)
```

Incidentes ainda abertos contam até o fim observado. A quantidade, maior duração e média continuam considerando os incidentes individualmente; somente o downtime total usa a união para evitar dupla contagem.

```text
disponibilidade (%) = 100 × (segundos observados - downtime) / segundos observados
downtime permitido = segundos observados × (100 - meta SLA) / 100
margem = downtime permitido - downtime real
```

Margem positiva significa tempo restante; margem negativa significa SLA excedido.

## Indicadores

- `Incidentes`: incidentes confirmados que se sobrepõem ao período.
- `Maior incidente`: maior sobreposição individual dentro do período.
- `Duração média`: média das sobreposições dos incidentes dentro do período.
- `MTTR`: média da duração real persistida dos incidentes recuperados no período.
- `Abertos agora`: quantidade atual de incidentes com `status = active`, independentemente do filtro histórico.

As agregações e a paginação do histórico acontecem no PostgreSQL pela RPC `get_site_sla_report`; checks não são transferidos em massa para o Node ou para o navegador.

O schema atual não possui histórico explícito de pausa e reativação. Ainda assim, uma pausa ocorrida e encerrada dentro do período aparece como gap entre checks e invalida a continuidade. Sem checks suficientes nas bordas ou ao redor de uma lacuna, a RPC prefere `Dados insuficientes` a inferir uptime.
