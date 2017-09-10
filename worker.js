const config = require('./config.json');
const DB = require('monk')(config.database);
const pg = require('./pg');
const kue = require('kue');
const queue = kue.createQueue({
    prefix: 'kue',
    redis: config.redis
});

queue.process('save_instance_history', function(job, cb) {
    saveInstanceHistory(job.data.instance).then(cb).catch(cb);
});

async function saveInstanceHistory(id) {
    let pgc = await pg.connect();
    let pg_instance_res = await pgc.query('SELECT name FROM instances WHERE id=$1', [id]);

    if(pg_instance_res.rows.length === 0) {
        throw new Error(`Instance ${id} not found.`);
    }

    let pg_instance = pg_instance_res.rows[0];

    let instance = await DB.get('instances').findOne({
        name: pg_instance.name
    });

    if(!instance)
        throw new Error(`MongoDB instance ${pg_instance.name} not found.`);

    try {
        await pgc.query('BEGIN');

        let res = await pgc.query('INSERT INTO instances_history(instance, uptime_all, ipv6, https_score, obs_score, users, connections, statuses, ' +
            'open_registrations, version) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING(timestamp)', [
            id,
            instance.uptime || 0,
            instance.ipv6 || false,
            instance.https_score || 0,
            instance.obs_score || 0,
            instance.users || 0,
            instance.connections || 0,
            instance.statuses || 0,
            instance.openRegistrations || false,
            instance.version || null
        ]);

        await pgc.query('UPDATE instances SET latest_history_save=$1 WHERE id=$2', [
            res.rows[0].timestamp,
            id
        ]);

        await pgc.query('COMMIT');
    } catch(e) {
        await pgc.query('ROLLBACK');
        throw e;
    } finally {
        await pgc.release();
    }
}