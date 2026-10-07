export default function SqlFirstSteps() {
  return <section className="lesson-orientation" data-testid="sql-first-steps" aria-labelledby="sql-first-steps-title">
    <h3 id="sql-first-steps-title">SQL с нуля: что ты сейчас будешь делать</h3>
    <p>SQL — язык для работы с данными. В этом уроке ты попросишь базу показать нужные столбцы таблицы. Ничего устанавливать не нужно: запрос выполняется прямо здесь, на учебных данных.</p>
    <p>База данных хранит таблицы. В таблице <code>tickets</code> записаны обращения людей в поддержку. Одна строка — одно обращение. Столбец хранит один признак: например, номер обращения или название сервиса.</p>
    <div className="result-table-wrap" tabIndex={0} role="region" aria-label="Фрагмент учебной таблицы обращений">
      <table>
        <caption>Три строки из таблицы tickets. Всего в учебном наборе 14 обращений.</caption>
        <thead><tr><th scope="col">ticket_id · номер</th><th scope="col">service · сервис</th><th scope="col">resolution_minutes · время решения</th></tr></thead>
        <tbody>
          <tr><td>1001</td><td>VPN</td><td>85</td></tr>
          <tr><td>1002</td><td>LMS</td><td>NULL</td></tr>
          <tr><td>1003</td><td>VPN</td><td>40</td></tr>
        </tbody>
      </table>
    </div>
    <p>У обращений 1001 и 1003 одинаковый сервис, но это разные обращения. <code>NULL</code> означает, что значение неизвестно или не задано: это не ноль. <code>ticket_id</code> помогает отличать одно обращение от другого.</p>
    <h4>Как прочитать первый запрос</h4>
    <pre><code>{'SELECT ticket_id\nFROM tickets;'}</code></pre>
    <dl>
      <div><dt>SELECT ticket_id</dt><dd>Покажи столбец с номером обращения.</dd></div>
      <div><dt>FROM tickets</dt><dd>Возьми строки из таблицы tickets.</dd></div>
    </dl>
    <p>Запрос создаёт таблицу результата, а исходные данные не меняет. Выбор столбца сам по себе не объединяет строки с одинаковыми значениями. Фильтры и удаление повторов мы разберём отдельно.</p>
    <p>Теперь попробуй предсказать результат другого запроса. Ошибиться в прогнозе нормально: затем ты запустишь SQL и сравнишь ответ с данными.</p>
  </section>;
}
