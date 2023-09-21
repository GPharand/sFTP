const fs = require('fs');
const ssh2 = require('ssh2');
const { Server } = ssh2;

const server = new Server({
    hostKeys: [fs.readFileSync('sftp_key')]
}, function (client) {
    console.log('Client connected!');

    client.on('authentication', function (ctx) {
        if (ctx.method === 'password'
            && ctx.username === 'username'
            && ctx.password === 'password') {
            ctx.accept();
        } else {
            ctx.reject();
        }
    }).on('ready', function () {
        console.log('Client authenticated!');

        client.on('session', function (accept, reject) {
            const session = accept();
            session.on('sftp', function (accept, reject) {
                console.log('Client SFTP session');
                const openSFTP = accept();
                bindSFTPEvents(openSFTP);
            });
        });
    }).on('end', function () {
        console.log('Client disconnected');
    });
});

server.listen(2222, '0.0.0.0', function () {
    console.log('Listening on port ' + this.address().port);
});

const openDirs = {};
const kDirHandle = fs.opendirSync('.').constructor.prototype[Symbol.for('kDirHandle')];

function bindSFTPEvents(sftp) {
    sftp.on('OPEN', function (reqid, filename, flags, attrs) {
        console.log('OPEN', reqid, filename, flags, attrs)
        let fd;
        fd = fs.openSync(filename, 'w+');
        const handle = Buffer.from(fd.toString());
        sftp.handle(reqid, handle);
    }).on('CLOSE', function (reqid, handle) {
        console.log('CLOSE', reqid, handle)
        const fd = parseInt(handle.toString(), 10);
        fs.closeSync(fd);
        sftp.status(reqid, 0);
    }).on('READ', function (reqid, handle, offset, length) {
        console.log('READ', reqid, handle, offset, length)
        const fd = parseInt(handle.toString(), 10);
        const buffer = Buffer.allocUnsafe(length);
        const bytesRead = fs.readSync(fd, buffer, 0, length, offset);
        sftp.data(reqid, buffer.slice(0, bytesRead));
    }).on('WRITE', function (reqid, handle, offset, data) {
        console.log('WRITE', reqid, handle, offset, data)
        const fd = parseInt(handle.toString(), 10);
        fs.writeSync(fd, data, 0, data.length, offset);
        sftp.status(reqid, 0);
    }).on('REALPATH', function (reqid, path) {
        console.log('REALPATH', reqid, path)
        const realPath = fs.realpathSync(path);
        sftp.name(reqid, [{ filename: realPath }]);
    }).on('STAT', function (reqid, path) {
        console.log('STAT', reqid, path)
        const stats = fs.statSync(path);
        sftp.attrs(reqid, stats);
    }).on('LIST', function (reqid, path) {
        console.log('LIST', reqid, path)
        const files = fs.readdirSync(path);
        const longname = files.map(file => {
            const stats = fs.statSync(path + '/' + file);
            return {
                filename: file,
                longname: `${stats.mode} ${stats.uid} ${stats.gid} ${stats.size} ${stats.mtime} ${file}`,
                attrs: stats
            };
        });
        sftp.name(reqid, longname);
    }).on('REMOVE', function (reqid, filename) {
        console.log('REMOVE', reqid, filename)
        fs.unlinkSync(filename);
        sftp.status(reqid, 0);
    }).on('RENAME', function (reqid, oldPath, newPath) {
        console.log('RENAME', reqid, oldPath, newPath)
        fs.renameSync(oldPath, newPath);
        sftp.status(reqid, 0);
    }).on('FSTAT', function (reqid, handle) {
        console.log('FSTAT', reqid, handle)
        const fd = parseInt(handle.toString(), 10);
        const stats = fs.fstatSync(fd);
        sftp.attrs(reqid, stats);
    }).on('FSETSTAT', function (reqid, handle, attrs) {
        console.log('FSETSTAT', reqid, handle, attrs)
        sftp.status(reqid, 8);
    }).on('OPENDIR', function (reqid, path) {
        console.log('OPENDIR', reqid, path)
        try {
            const files = fs.readdirSync(path);
            if (files && files.length > 0) {
                const handle = Buffer.from(path); // Utilisez simplement le chemin comme "handle"
                openDirs[handle.toString()] = path;
                sftp.handle(reqid, handle);
            } else {
                console.log('No files found in the directory');
                sftp.status(reqid, ssh2.SFTP_STATUS_CODE.NO_SUCH_FILE);
            }
        } catch (err) {
            console.error(`Error opening directory: ${err.message}`);
            sftp.status(reqid, ssh2.SFTP_STATUS_CODE.FAILURE);
        }
    }).on('READDIR', function (reqid, handle) {
        console.log('READDIR', reqid, handle)
        if (handle && openDirs[handle.toString()]) {
            const path = openDirs[handle.toString()];
            const dir = fs.readdirSync(path, { withFileTypes: true });
            const entries = dir.map(dirent => {
                const stats = fs.statSync(path + '/' + dirent.name);
                return {
                    filename: dirent.name,
                    longname: `${stats.mode} ${stats.uid} ${stats.gid} ${stats.size} ${stats.mtime} ${dirent.name}`,
                    attrs: stats
                };
            });
            sftp.name(reqid, entries);
        } else {
            sftp.status(reqid, 4);
        }
    }).on('LSTAT', function (reqid, path) {
        console.log('LSTAT', reqid, path)
        const stats = fs.lstatSync(path);
        sftp.attrs(reqid, stats);
    }).on('RMDIR', function (reqid, path) {
        console.log('RMDIR', reqid, path)
        fs.rmdirSync(path);
        sftp.status(reqid, 0);
    }).on('MKDIR', function (reqid, path, attrs) {
        console.log('MKDIR', reqid, path, attrs)
        fs.mkdirSync(path, { recursive: true });
        sftp.status(reqid, 0);
    }).on('READLINK', function (reqid, path) {
        console.log('READLINK', reqid, path)
        const target = fs.readlinkSync(path);
        sftp.name(reqid, [{ filename: target }]);
    }).on('SYMLINK', function (reqid, targetPath, linkPath) {
        console.log('SYMLINK', reqid, targetPath, linkPath)
        fs.symlinkSync(targetPath, linkPath);
        sftp.status(reqid, 0);
    }).on('SETSTAT', function (reqid, path, attrs) {
        console.log('SETSTAT', reqid, path, attrs)
        sftp.status(reqid, 8);
    });
}