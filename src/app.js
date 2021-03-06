/**
 * @file Transformar COPYBOOK (COBOL) em JSON.
 * @author @douglaspands
 * @since 2017-10-25
 */
'use strict';
// Modules
var fs = require('fs');
var _ = require('lodash');
var path = require('path');
// Is it loaded as a module?
const runningAsScript = !module.parent;

if(runningAsScript) {
    // Start
    console.time('Time Spent');
    // Load Input File
    var nomeArquivo = (fs.readdirSync('./input_file')[0] || '');
    var arqEnt = ((fs.readFileSync(path.join('./input_file', nomeArquivo), 'utf8')) || '');
    // Arquivo tratado (gerar linhas de codigo do book)
    var linhasCodigo = copybook2list(arqEnt);
    // Generate JSON
    var codigoJson = copybook2json(linhasCodigo);
    // Write File
    var arqSai = JSON.stringify(codigoJson.data, null, 4);
    fs.writeFileSync(path.join('./output_json/', (nomeArquivo.replace((/(\.)(.)+/g), '') + '.json')), arqSai, 'utf8');
    // Fim
    console.log('Execution Completed')
    console.timeEnd('Time Spent');
}

function pipeline(copybook) {
    const list = copybook2list(copybook);
    const json = copybook2json(list);

    return json;
}

/**
 * Generates list of lines and parameters.
 * @param {string} copybook COPYBOOK COBOL.
 * @return {array} List of COPYBOOK parameters.
 */
function copybook2list(copybook, padding=0) {
    var copybookLines = (_
        .reduce(copybook.split('\n'), function (acum, l) {
            if(!padding) l = l.trim()
            // TODO: Handle default values.
            l = l.replace(/VALUES?\s\S+/m, '')
            if (l.substr(padding, 1) !== '*' && !(/^( )+$/g).test(l)) {
                acum.push(l.substr(padding, _.size(l) - padding));
            }
            return acum;
        }, [])).join('\n');

    var returnValue = _.reduce(copybookLines.split('\n'), function (acum, o, key) {
        var regex = new RegExp('(\r\n)(\-)( )+(\')', 'g');
        var result = o.replace(regex, '');
        regex = new RegExp('(\r\n)+', 'g');
        result = result.replace(regex, '');
        regex = new RegExp('(\')(.+)(\')', 'g');
        var defaultValue = result.match(regex);
        if (defaultValue) {
            result = result.replace(regex, '***');
        }
        regex = new RegExp('( )+', 'g');
        result = result.replace(regex, ' ');
        result = _.trimEnd(_.trimStart(result));
        result = result.split(' ');
        if (defaultValue) {
            regex = new RegExp('[\*]{3}', 'g');
            result = _.map(result, function (o, key) {
                return o.replace(regex, defaultValue);
            });
        }
        if (_.size(result[0]) > 0) {
            acum.push(result);
        }
        return acum;
    }, []);
    return returnValue;
}
/**
 * Convert the COPYBOOK to JSON.
 * @param {array} book Array of COPYBOOK contents.
 * @param {number} point Ponteiro de onde sera iniciado a contagem.
 * @returns {array} Retorna lista de campos no formato de JSON.
 */
function copybook2json(book, point) {
    var startPoint = (point === undefined || point === 0) ? 0 : point + 1;
    var lastPosition = point >> 0;
    var index = 0, lengthBook = book.length, i = 0, j = 0, k = 0;
    var returnValue = [];
    while (index < lengthBook) {
        var fieldName = _.snakeCase(book[index][1]);
        var fieldNameMainframe = book[index][1];
        var item, itemsGroup = [], occurs = [], newGroup = {}, objNew = {};
        switch (true) {
            // Handle REDEFINE Statements
            case (_.includes(book[index], '88')):
                // TODO: Handle conditional variables.
                break;
            case (_.includes(book[index], 'REDEFINES') && !_.includes(book[index], 'PIC')):
                k = (index === 0) ? 1 : index + 1;
                itemsGroup = [];
                item = parseInt(book[index][0]);
                while (k < lengthBook && parseInt(book[k][0]) > item) {
                    itemsGroup.push(book[k]);
                    k++;
                };
                newGroup = copybook2json(itemsGroup, redefines(objNew, book[index][3]));
                objNew['name'] = fieldName;
                objNew['copybook_name'] = fieldNameMainframe;
                objNew['type'] = 'group';
                objNew['redefines'] = _.snakeCase(book[index][3]);
                objNew['data'] = newGroup['data'];
                objNew['start'] = newGroup['start'];
                objNew['length'] = newGroup['length'];
                lastPosition = (newGroup['length']);
                index = k - 1;
                break;
            // Tratamento de redefinição de variavel comum
            case (_.includes(book[index], 'REDEFINES') && _.includes(book[index], 'PIC')):
                objNew['name'] = fieldName;
                objNew['copybook_name'] = fieldNameMainframe;
                objNew['type'] = getType(book[index][5], _.find(['COMP', 'COMP-3'], function (item) { return item === book[index][4] }));
                objNew['redefines'] = _.snakeCase(book[index][3]);
                objNew['start'] = (redefines(objNew, book[index][3]) + 1);
                objNew['length'] = picture(book[index][5], _.find(['COMP', 'COMP-3'], function (item) { return item === book[index][4] }));
                break;
            // Tratamento de pictures
            case _.includes(book[index], 'PIC'):
                objNew['name'] = fieldName;
                objNew['copybook_name'] = fieldNameMainframe;
                objNew['type'] = getType(book[index][3], _.find(['COMP', 'COMP-3'], function (item) { return item === book[index][4] }));
                objNew['start'] = (lastPosition === 0) ? 0 : lastPosition + 1;
                objNew['length'] = picture(book[index][3], _.find(['COMP', 'COMP-3'], function (item) { return item === book[index][4] }));
                lastPosition += (lastPosition === 0) ? (objNew['length'] - 1) : objNew['length'];
                break;
            // Tratamento de listas
            case _.includes(book[index], 'OCCURS'):
                var occursLine = book[index];
                var repeat = parseInt(book[index][3]);
                j = index + 1;
                occurs = [];
                item = parseInt(book[index][0]);
                while (j < lengthBook && parseInt(book[j][0]) > item) {
                    occurs.push(book[j]);
                    j++;
                };
                var newList = [], endOccurs = lastPosition;
                for (i = 0; i < repeat; i++) {
                    var newGroup = copybook2json(occurs, endOccurs);
                    newList.push(newGroup['data']);
                    endOccurs = (newGroup['length']);
                }
                objNew['name'] = fieldName;
                objNew['copybook_name'] = fieldNameMainframe;
                objNew['type'] = 'list';
                objNew['occurs'] = parseInt(occursLine[occursLine.indexOf('OCCURS') + 1], 10);
                objNew['data'] = newList;
                objNew['start'] = (lastPosition === 0) ? 0 : lastPosition + 1;
                objNew['length'] = endOccurs;
                lastPosition = endOccurs;
                index = j - 1;
                break;
            // Tratamento de itens de grupo
            case (book[index][0] !== '88' && book[index][2] === undefined):
                k = (index === 0) ? 1 : index + 1;
                itemsGroup = [];
                item = parseInt(book[index][0]);
                while (k < lengthBook && parseInt(book[k][0]) > item) {
                    itemsGroup.push(book[k]);
                    k++;
                };
                newGroup = copybook2json(itemsGroup, lastPosition);
                objNew['name'] = fieldName;
                objNew['copybook_name'] = fieldNameMainframe;
                objNew['type'] = 'group';
                objNew['data'] = newGroup['data'];
                objNew['start'] = newGroup['start'];
                objNew['length'] = newGroup['length'];
                lastPosition = (newGroup['length']);
                index = k - 1;
                break;
            default:
                break;
        };
        if (!_.isEmpty(objNew)) {
            returnValue.push(objNew);
        }
        index++;
    };
    return { data: returnValue, start: startPoint, length: lastPosition };
};
/**
 * Calcula o tamanho da variavel dentro do COPYBOOK.
 * @param {string} pic PIC do COPYBOOK.
 * @param {string} type Tipo do PIC (COMP, COMP-3, etc...)
 * @return {number} Retorna o tamanho da variavel.
 */
function picture(pic, type) {
    var tam = _.map(pic.split('V'), function (n) {
        if (/\(/g.test(n)) return parseInt(n.replace(/(S?9\(|X\(|\)|\()/g, ''))
        else return n.length;
    });
    var result = 0;
    _.forEach(tam, function (c) { result += c });
    switch (type) {
        case 'COMP':
            if (result < 5) result = 2;
            else result = 4;
            break;
        case 'COMP-3':
            result = Math.floor(result / 2) + 1;
            break;
        default:
            break;
    }
    return result;
};
/**
 * Verificar tipagem da variavel.
 * @param {string} pic PIC do COPYBOOK.
 * @param {string} type Tipo do PIC (COMP, COMP-3, etc...)
 * @return {string} Retorna o tipo da variavel.
 */
function getType(pic, type) {
    if (_.includes(['COMP', 'COMP-3'], type)) {
        return 'binary';
    } else if ((/9/g).test(pic)) {
        return 'number';
    } else {
        return 'string';
    }
};
/**
 * Pesquisa de variavel com o mesmo nome.
 * @param {object} objectCopybook Objeto que representa o COPYBOOK.
 * @param {string} fieldNameMainframe Nome da variavel no COPYBOOK.
 * @return {number} Retorna a posição inicial da variavel.
 */
function redefines(objectCopybook, fieldNameMainframe) {
    var pos = -1;
    for (var prop in objectCopybook) {
        if (_.isObjectLike(objectCopybook[prop])) {
            if (objectCopybook[prop]['copybook_name'] === fieldNameMainframe) {
                pos = objectCopybook[prop]['start'];
            } else {
                if (objectCopybook[prop]['data']) {
                    if (_.isArray(objectCopybook[prop]['data'])) {
                        var temp;
                        _.forEach(objectCopybook[prop]['data'], function (o) {
                            temp = redefines(o, fieldNameMainframe);
                            if (temp > -1) {
                                pos = temp;
                                return false;
                            }
                        });
                    } else {
                        var temp = redefines(objectCopybook[prop]['data'], fieldNameMainframe);
                        if (temp > -1) {
                            pos = temp;
                        }
                    }
                }
            }
        }
    }
    return pos - 1;
};

module.exports = { copybook2list, copybook2json, pipeline }